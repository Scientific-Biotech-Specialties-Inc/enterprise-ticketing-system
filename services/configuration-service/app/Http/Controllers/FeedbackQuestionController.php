<?php

namespace App\Http\Controllers;

use App\Events\FeedbackFormStatusUpdated;
use App\Events\FeedbackQuestionsUpdated;
use App\Models\FeedbackFormSetting;
use App\Models\FeedbackQuestion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class FeedbackQuestionController extends Controller
{
    /**
     * Helper to write configuration audit logs to ticket_audit_logs.
     */
    protected function logAudit(?Request $request, string $actionType, string $category, string $action, string $text): void
    {
        try {
            $userId = $request?->user()?->emp_id
                ?? $request?->user()?->id
                ?? DB::table('employees')->where('role', 'superadmin')->value('emp_id')
                ?? DB::table('employees')->value('emp_id')
                ?? 1;

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID'    => null,
                'action_type'  => $actionType,
                'action_by_ID' => $userId,
                'actor_type'   => 'superadmin',
                'details'      => json_encode([
                    'module'   => 'Feedback Form Configuration',
                    'category' => $category,
                    'action'   => $action,
                    'text'     => $text,
                ]),
                'created_at'   => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to record feedback question audit log: " . $e->getMessage());
        }
    }

    /**
     * Dispatch broadcast event and Redis notice safely.
     */
    protected function dispatchUpdateEvent(string $category, string $action, array $questions): void
    {
        try {
            event(new FeedbackQuestionsUpdated($category, $action, $questions));
        } catch (\Throwable $e) {
            Log::warning("Failed to broadcast FeedbackQuestionsUpdated event: " . $e->getMessage());
        }
    }

    /**
     * Get all questions grouped by category or filtered by category.
     * Categories are derived dynamically from whatever exists in the DB.
     */
    public function index(Request $request)
    {
        $category = $request->query('category');
        $query = FeedbackQuestion::orderBy('order_position', 'asc')->orderBy('id', 'asc');

        if ($category) {
            $query->where('category', $category);
            $questions = $query->get()->map->toApiResponse();
            return response()->json([
                'category'  => $category,
                'questions' => $questions,
            ]);
        }

        $all = $query->get();

        // Build grouped map from all distinct categories that actually exist in the DB
        $grouped = [];
        foreach ($all as $q) {
            $cat = $q->category;
            if (!array_key_exists($cat, $grouped)) {
                $grouped[$cat] = [];
            }
            $grouped[$cat][] = $q->toApiResponse();
        }

        // Collect known categories list (sorted)
        $categories = array_keys($grouped);
        sort($categories);

        return response()->json([
            'grouped'    => $grouped,
            'categories' => $categories,
            'questions'  => $all->map->toApiResponse(),
        ]);
    }

    /**
     * Get active (enabled) questions for a specific ticket category.
     * Used by the customer feedback form rendering engine.
     * Works with any category name (not limited to legacy IT/Service/Others enum).
     * Respects both the master feedback toggle and the per-category toggle.
     */
    public function getByCategory(string $category)
    {
        $requestedCategory = trim($category);

        // Check master toggle — if disabled, return empty list so customer form is suppressed
        $masterSetting = FeedbackFormSetting::where('key', 'master_toggle')->first();
        if ($masterSetting && !$masterSetting->is_enabled) {
            return response()->json([
                'category'          => $requestedCategory,
                'questions'         => [],
                'category_enabled'  => false,
                'master_enabled'    => false,
            ]);
        }

        // Check per-category toggle — if explicitly disabled, suppress this category's form
        $catKey = "feedback_category:{$requestedCategory}";
        $catSetting = FeedbackFormSetting::where('key', $catKey)->first();
        if ($catSetting && !$catSetting->is_enabled) {
            return response()->json([
                'category'          => $requestedCategory,
                'questions'         => [],
                'category_enabled'  => false,
                'master_enabled'    => true,
            ]);
        }

        // 1. Try exact match first
        $questions = FeedbackQuestion::where('category', $requestedCategory)
            ->where('is_enabled', true)
            ->orderBy('order_position', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        // 2. Try case-insensitive match
        if ($questions->isEmpty()) {
            $questions = FeedbackQuestion::whereRaw('LOWER(category) = ?', [strtolower($requestedCategory)])
                ->where('is_enabled', true)
                ->orderBy('order_position', 'asc')
                ->orderBy('id', 'asc')
                ->get();
        }

        // 3. Resolve the actual stored category name for response
        $resolvedCategory = $questions->isNotEmpty()
            ? $questions->first()->category
            : $requestedCategory;

        // 4. Fallback: return all enabled questions across any category if none found
        if ($questions->isEmpty()) {
            $questions = FeedbackQuestion::where('is_enabled', true)
                ->orderBy('order_position', 'asc')
                ->orderBy('id', 'asc')
                ->get();
            $resolvedCategory = $requestedCategory;
        }

        return response()->json([
            'category'          => $resolvedCategory,
            'questions'         => $questions->map->toApiResponse(),
            'category_enabled'  => true,
            'master_enabled'    => true,
        ]);
    }

    /**
     * Seed default feedback questions for a new category.
     * Called automatically when a new equipment/machine category is created.
     * Idempotent: skips seeding if questions already exist for the category.
     */
    public function seedCategory(Request $request)
    {
        $validated = $request->validate([
            'category' => 'required|string|max:100',
        ]);

        $category = trim($validated['category']);

        // Idempotency: do nothing if questions already exist for this category
        $existing = FeedbackQuestion::where('category', $category)->count();
        if ($existing > 0) {
            return response()->json([
                'message'  => "Feedback questions already exist for '{$category}'. No changes made.",
                'seeded'   => false,
                'category' => $category,
            ]);
        }

        // Generic default questions applicable to any equipment/service category
        $defaults = [
            [
                'text'           => 'How would you rate the overall quality of the support provided?',
                'response_type'  => 'Star Rating',
                'options'        => null,
                'is_enabled'     => true,
                'order_position' => 1,
            ],
            [
                'text'           => 'Was your issue resolved satisfactorily?',
                'response_type'  => 'Multiple Choice',
                'options'        => ['Yes', 'No'],
                'is_enabled'     => true,
                'order_position' => 2,
            ],
            [
                'text'           => 'Do you have any additional feedback or suggestions?',
                'response_type'  => 'Free Text',
                'options'        => null,
                'is_enabled'     => false,
                'order_position' => 3,
            ],
        ];

        DB::transaction(function () use ($defaults, $category) {
            foreach ($defaults as $q) {
                FeedbackQuestion::create([
                    'category'       => $category,
                    'text'           => $q['text'],
                    'response_type'  => $q['response_type'],
                    'options'        => $q['options'],
                    'is_enabled'     => $q['is_enabled'],
                    'order_position' => $q['order_position'],
                    'is_default'     => true,
                ]);
            }
        });

        $this->logAudit(
            $request,
            'config_create',
            $category,
            'seeded',
            "Seeded default feedback questions for new equipment category '{$category}'"
        );

        $seededQuestions = FeedbackQuestion::where('category', $category)
            ->orderBy('order_position')
            ->get()
            ->map->toApiResponse()
            ->toArray();

        $this->dispatchUpdateEvent($category, 'seeded', $seededQuestions);

        return response()->json([
            'message'   => "Default feedback questions seeded for '{$category}'.",
            'seeded'    => true,
            'category'  => $category,
            'questions' => $seededQuestions,
        ], 201);
    }

    /**
     * Create a new feedback question for a category.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'category'      => 'required|string|max:50',
            'text'          => ['required', 'string', 'max:1000', new \App\Rules\NoMarkup()],
            'response_type' => 'nullable|string|in:Star Rating,Yes / No,Multiple Choice,Checkbox,Free Text',
            'responseType'  => 'nullable|string|in:Star Rating,Yes / No,Multiple Choice,Checkbox,Free Text',
            'options'       => 'nullable|array',
            'is_enabled'    => 'nullable|boolean',
            'isEnabled'     => 'nullable|boolean',
        ]);

        $category = trim($validated['category']);
        $text = trim($validated['text']);
        $responseType = $validated['response_type'] ?? $validated['responseType'] ?? 'Star Rating';
        $isEnabled = $validated['is_enabled'] ?? $validated['isEnabled'] ?? true;

        if ($responseType === 'Yes / No') {
            $options = ['Yes', 'No'];
        } elseif (in_array($responseType, ['Multiple Choice', 'Checkbox'], true)) {
            $rawOptions = $validated['options'] ?? [];
            $options = is_array($rawOptions) ? array_values(array_filter(array_map('trim', $rawOptions), fn($opt) => $opt !== '')) : [];
        } else {
            $options = null;
        }

        $maxOrder = (int) FeedbackQuestion::where('category', $category)->max('order_position');

        $question = FeedbackQuestion::create([
            'category'       => $category,
            'text'           => $text,
            'response_type'  => $responseType,
            'options'        => $options,
            'is_enabled'     => (bool) $isEnabled,
            'order_position' => $maxOrder + 1,
            'is_default'     => false,
        ]);

        $this->logAudit(
            $request,
            'config_create',
            $category,
            'created',
            "Created new feedback question for '{$category}': '{$text}' ({$responseType})"
        );

        $allCat = FeedbackQuestion::where('category', $category)->orderBy('order_position')->get()->map->toApiResponse()->toArray();
        $this->dispatchUpdateEvent($category, 'created', $allCat);

        return response()->json([
            'message'  => "Feedback question for '{$category}' created successfully.",
            'question' => $question->toApiResponse(),
        ], 201);
    }

    /**
     * Resolve a question by numeric ID, slug (e.g. 'it-1', 'svc-2', 'oth-3'), or category + order.
     */
    protected function findQuestion($id, ?string $category = null): ?FeedbackQuestion
    {
        // 1. Direct numeric primary key lookup
        if (is_numeric($id)) {
            $q = FeedbackQuestion::find((int) $id);
            if ($q) {
                return $q;
            }
        }

        // 2. Slug parsing like 'it-1', 'it-2', 'svc-1', 'oth-3'
        $idStr = strtolower(trim((string) $id));
        if (preg_match('/^(it|svc|service|oth|others)[-_]?(\d+)$/i', $idStr, $m)) {
            $prefix = strtolower($m[1]);
            $index = (int) $m[2];
            $cat = match ($prefix) {
                'it' => 'IT',
                'svc', 'service' => 'Service',
                default => 'Others',
            };

            // Find question by order position or nth record in that category
            $q = FeedbackQuestion::where('category', $cat)
                ->where('order_position', $index)
                ->first();

            if (!$q) {
                $q = FeedbackQuestion::where('category', $cat)
                    ->orderBy('order_position', 'asc')
                    ->orderBy('id', 'asc')
                    ->skip(max(0, $index - 1))
                    ->first();
            }

            if ($q) {
                return $q;
            }
        }

        // 3. Match by category if provided
        if ($category) {
            $normCat = ucfirst(strtolower(trim($category)));
            if (!in_array($normCat, ['IT', 'Service', 'Others'])) {
                if (stripos($category, 'it') !== false) {
                    $normCat = 'IT';
                } elseif (stripos($category, 'service') !== false) {
                    $normCat = 'Service';
                } else {
                    $normCat = 'Others';
                }
            }

            $q = FeedbackQuestion::where('category', $normCat)
                ->orderBy('order_position', 'asc')
                ->orderBy('id', 'asc')
                ->first();

            if ($q) {
                return $q;
            }
        }

        return null;
    }

    /**
     * Update an existing feedback question or create it if not found.
     */
    public function update(Request $request, $id)
    {
        $categoryParam = $request->input('category');
        $question = $this->findQuestion($id, $categoryParam);

        $validated = $request->validate([
            'category'      => 'nullable|string|max:50',
            'text'          => ['nullable', 'string', 'max:1000', new \App\Rules\NoMarkup()],
            'response_type' => 'nullable|string|in:Star Rating,Yes / No,Multiple Choice,Checkbox,Free Text',
            'responseType'  => 'nullable|string|in:Star Rating,Yes / No,Multiple Choice,Checkbox,Free Text',
            'options'       => 'nullable|array',
            'is_enabled'    => 'nullable|boolean',
            'isEnabled'     => 'nullable|boolean',
        ]);

        // If question not found by ID or slug, upsert a new question for the category
        if (!$question) {
            $cat = $validated['category'] ?? $categoryParam ?? 'IT';
            $text = trim($validated['text'] ?? 'Customer Satisfaction Question');
            $responseType = $validated['response_type'] ?? $validated['responseType'] ?? 'Star Rating';
            $isEnabled = $validated['is_enabled'] ?? $validated['isEnabled'] ?? true;

            if ($responseType === 'Yes / No') {
                $options = ['Yes', 'No'];
            } elseif (in_array($responseType, ['Multiple Choice', 'Checkbox'], true)) {
                $rawOptions = $validated['options'] ?? [];
                $options = is_array($rawOptions) ? array_values(array_filter(array_map('trim', $rawOptions), fn($opt) => $opt !== '')) : [];
            } else {
                $options = null;
            }

            $maxOrder = (int) FeedbackQuestion::where('category', $cat)->max('order_position');

            $question = FeedbackQuestion::create([
                'category'       => $cat,
                'text'           => $text,
                'response_type'  => $responseType,
                'options'        => $options,
                'is_enabled'     => (bool) $isEnabled,
                'order_position' => $maxOrder + 1,
                'is_default'     => false,
            ]);

            $this->logAudit(
                $request,
                'config_create',
                $cat,
                'created',
                "Created and persisted feedback question in '{$cat}': '{$text}'"
            );

            $allCat = FeedbackQuestion::where('category', $cat)->orderBy('order_position')->get()->map->toApiResponse()->toArray();
            $this->dispatchUpdateEvent($cat, 'created', $allCat);

            return response()->json([
                'message'  => 'Feedback question saved successfully.',
                'question' => $question->toApiResponse(),
            ]);
        }

        $category = $question->category;
        $newIsEnabled = $validated['is_enabled'] ?? $validated['isEnabled'] ?? $question->is_enabled;

        // Block disabling if it's the last remaining enabled question
        if ($question->is_enabled && !$newIsEnabled) {
            $otherEnabled = FeedbackQuestion::where('category', $category)
                ->where('is_enabled', true)
                ->where('id', '!=', $question->id)
                ->count();

            if ($otherEnabled === 0) {
                return response()->json([
                    'message' => "At least one question must stay enabled for the '{$category}' category.",
                ], 422);
            }
        }

        $updates = [];
        if (isset($validated['text'])) {
            $updates['text'] = trim($validated['text']);
        }
        $resType = $validated['response_type'] ?? $validated['responseType'] ?? null;
        if ($resType) {
            $updates['response_type'] = $resType;
        }

        $effectiveType = $resType ?? $question->response_type;
        if ($effectiveType === 'Yes / No') {
            $updates['options'] = ['Yes', 'No'];
        } elseif (in_array($effectiveType, ['Multiple Choice', 'Checkbox'], true)) {
            if (array_key_exists('options', $validated)) {
                $rawOptions = $validated['options'] ?? [];
                $updates['options'] = is_array($rawOptions) ? array_values(array_filter(array_map('trim', $rawOptions), fn($opt) => $opt !== '')) : [];
            }
        } else {
            $updates['options'] = null;
        }

        if (isset($validated['is_enabled']) || isset($validated['isEnabled'])) {
            $updates['is_enabled'] = (bool) $newIsEnabled;
        }

        $question->update($updates);

        $this->logAudit(
            $request,
            'config_update',
            $category,
            'edited',
            "Updated feedback question ID {$question->id} in '{$category}': '{$question->text}'"
        );

        $allCat = FeedbackQuestion::where('category', $category)->orderBy('order_position')->get()->map->toApiResponse()->toArray();
        $this->dispatchUpdateEvent($category, 'edited', $allCat);

        return response()->json([
            'message'  => 'Feedback question updated successfully.',
            'question' => $question->fresh()->toApiResponse(),
        ]);
    }

    /**
     * Toggle enabled state of a feedback question.
     */
    public function toggle(Request $request, $id)
    {
        $question = $this->findQuestion($id, $request->input('category'));
        if (!$question) {
            return response()->json(['message' => 'Feedback question not found.'], 404);
        }

        $category = $question->category;
        $targetEnabled = !$question->is_enabled;

        if ($question->is_enabled && !$targetEnabled) {
            $otherEnabled = FeedbackQuestion::where('category', $category)
                ->where('is_enabled', true)
                ->where('id', '!=', $question->id)
                ->count();

            if ($otherEnabled === 0) {
                return response()->json([
                    'message' => "At least one question must stay enabled for the '{$category}' category.",
                ], 422);
            }
        }

        $question->update(['is_enabled' => $targetEnabled]);

        $actionWord = $targetEnabled ? 'enabled' : 'disabled';
        $this->logAudit(
            $request,
            'config_update',
            $category,
            $actionWord,
            ucfirst($actionWord) . " feedback question ID {$question->id} in '{$category}': '{$question->text}'"
        );

        $allCat = FeedbackQuestion::where('category', $category)->orderBy('order_position')->get()->map->toApiResponse()->toArray();
        $this->dispatchUpdateEvent($category, $actionWord, $allCat);

        return response()->json([
            'message'  => "Feedback question {$actionWord} successfully.",
            'question' => $question->fresh()->toApiResponse(),
        ]);
    }

    /**
     * Reorder feedback questions within a category.
     */
    public function reorder(Request $request)
    {
        $validated = $request->validate([
            'category' => 'required|string',
            'order'    => 'required|array',
            'order.*'  => 'required',
        ]);

        $category = trim($validated['category']);
        $orderIds = $validated['order'];

        DB::transaction(function () use ($orderIds, $category) {
            foreach ($orderIds as $idx => $qid) {
                $q = $this->findQuestion($qid, $category);
                if ($q) {
                    $q->update(['order_position' => $idx + 1]);
                }
            }
        });

        $this->logAudit(
            $request,
            'config_update',
            $category,
            'reordered',
            "Reordered feedback questions for category '{$category}'"
        );

        $questions = FeedbackQuestion::where('category', $category)
            ->orderBy('order_position', 'asc')
            ->orderBy('id', 'asc')
            ->get()
            ->map->toApiResponse();

        $this->dispatchUpdateEvent($category, 'reordered', $questions->toArray());

        return response()->json([
            'message'   => "Feedback questions for '{$category}' reordered successfully.",
            'category'  => $category,
            'questions' => $questions,
        ]);
    }

    /**
     * Soft delete / remove a feedback question.
     * Historical responses remain intact due to soft deletes and foreign key preservation.
     */
    public function destroy(Request $request, $id)
    {
        $question = $this->findQuestion($id, $request->input('category') ?? $request->query('category'));
        if (!$question) {
            return response()->json(['message' => 'Feedback question not found.'], 404);
        }

        $category = $question->category;

        // Block removing if it is enabled and is the last remaining enabled question
        if ($question->is_enabled) {
            $otherEnabled = FeedbackQuestion::where('category', $category)
                ->where('is_enabled', true)
                ->where('id', '!=', $question->id)
                ->count();

            if ($otherEnabled === 0) {
                return response()->json([
                    'message' => "At least one question must stay enabled for the '{$category}' category.",
                ], 422);
            }
        }

        $questionText = $question->text;
        // Soft delete question
        $question->delete();

        $this->logAudit(
            $request,
            'config_delete',
            $category,
            'removed',
            "Removed feedback question ID {$question->id} from '{$category}': '{$questionText}'"
        );

        $allCat = FeedbackQuestion::where('category', $category)->orderBy('order_position')->get()->map->toApiResponse()->toArray();
        $this->dispatchUpdateEvent($category, 'removed', $allCat);

        return response()->json([
            'message' => 'Feedback question removed successfully. Historical responses remain preserved.',
        ]);
    }

    /**
     * Reset questions for a category (or all categories) back to system defaults.
     */
    public function reset(Request $request)
    {
        $category = $request->input('category');

        $defaults = [
            'IT' => [
                [
                    'text'           => "How would you rate the technician's technical knowledge?",
                    'response_type'  => 'Star Rating',
                    'options'        => null,
                    'is_enabled'     => true,
                    'order_position' => 1,
                    'is_default'     => true,
                ],
                [
                    'text'           => 'Was your issue resolved on the first visit?',
                    'response_type'  => 'Multiple Choice',
                    'options'        => ['Yes', 'No'],
                    'is_enabled'     => true,
                    'order_position' => 2,
                    'is_default'     => true,
                ],
                [
                    'text'           => 'Do you have any additional feedback about the IT support provided?',
                    'response_type'  => 'Free Text',
                    'options'        => null,
                    'is_enabled'     => false,
                    'order_position' => 3,
                    'is_default'     => true,
                ],
            ],
            'Service' => [
                [
                    'text'           => 'How satisfied are you with the timeliness and professionalism of the service engineer?',
                    'response_type'  => 'Star Rating',
                    'options'        => null,
                    'is_enabled'     => true,
                    'order_position' => 1,
                    'is_default'     => true,
                ],
                [
                    'text'           => 'Did the technician explain the issue and repair clearly?',
                    'response_type'  => 'Multiple Choice',
                    'options'        => ['Yes', 'No'],
                    'is_enabled'     => true,
                    'order_position' => 2,
                    'is_default'     => true,
                ],
                [
                    'text'           => 'Any suggestions for improving our on-site service experience?',
                    'response_type'  => 'Free Text',
                    'options'        => null,
                    'is_enabled'     => true,
                    'order_position' => 3,
                    'is_default'     => true,
                ],
            ],
            'Others' => [
                [
                    'text'           => 'How would you rate your overall support experience?',
                    'response_type'  => 'Star Rating',
                    'options'        => null,
                    'is_enabled'     => true,
                    'order_position' => 1,
                    'is_default'     => true,
                ],
                [
                    'text'           => 'Would you recommend our support team to others?',
                    'response_type'  => 'Multiple Choice',
                    'options'        => ['Yes', 'No'],
                    'is_enabled'     => true,
                    'order_position' => 2,
                    'is_default'     => true,
                ],
                [
                    'text'           => 'Please share any additional comments or suggestions for our team.',
                    'response_type'  => 'Free Text',
                    'options'        => null,
                    'is_enabled'     => false,
                    'order_position' => 3,
                    'is_default'     => true,
                ],
            ],
        ];

        // Generic fallback defaults used for any category not in the static map above
        $genericDefaults = [
            [
                'text'           => 'How would you rate the overall quality of the support provided?',
                'response_type'  => 'Star Rating',
                'options'        => null,
                'is_enabled'     => true,
                'order_position' => 1,
                'is_default'     => true,
            ],
            [
                'text'           => 'Was your issue resolved satisfactorily?',
                'response_type'  => 'Multiple Choice',
                'options'        => ['Yes', 'No'],
                'is_enabled'     => true,
                'order_position' => 2,
                'is_default'     => true,
            ],
            [
                'text'           => 'Do you have any additional feedback or suggestions?',
                'response_type'  => 'Free Text',
                'options'        => null,
                'is_enabled'     => false,
                'order_position' => 3,
                'is_default'     => true,
            ],
        ];

        DB::transaction(function () use ($defaults, $genericDefaults, $category) {
            $categoriesToReset = $category ? [$category] : array_keys($defaults);

            foreach ($categoriesToReset as $cat) {
                $catDefaults = $defaults[$cat] ?? $genericDefaults;

                // Soft-delete current questions for this category
                FeedbackQuestion::where('category', $cat)->delete();

                // Re-insert defaults (either category-specific or generic)
                foreach ($catDefaults as $q) {
                    FeedbackQuestion::create([
                        'category'       => $cat,
                        'text'           => $q['text'],
                        'response_type'  => $q['response_type'],
                        'options'        => $q['options'],
                        'is_enabled'     => $q['is_enabled'],
                        'order_position' => $q['order_position'],
                        'is_default'     => true,
                    ]);
                }
            }
        });

        $this->logAudit(
            $request,
            'config_update',
            $category ?? 'All',
            'reset',
            "Reset feedback questions to default configuration" . ($category ? " for category '{$category}'" : " for all categories")
        );

        $all = FeedbackQuestion::orderBy('order_position', 'asc')->get();

        // Build dynamic grouped response (not limited to hardcoded categories)
        $grouped = [];
        foreach ($all as $q) {
            $cat = $q->category;
            if (!array_key_exists($cat, $grouped)) {
                $grouped[$cat] = [];
            }
            $grouped[$cat][] = $q->toApiResponse();
        }

        $categories = array_keys($grouped);
        sort($categories);

        $this->dispatchUpdateEvent($category ?? 'All', 'reset', $all->map->toApiResponse()->toArray());

        return response()->json([
            'message'    => 'Feedback questions restored to defaults successfully.',
            'grouped'    => $grouped,
            'categories' => $categories,
            'questions'  => $all->map->toApiResponse(),
        ]);
    }

    /**
     * Get the master feedback form enabled/disabled status.
     */
    public function getStatus()
    {
        $setting = FeedbackFormSetting::firstOrCreate(
            ['key' => 'master_toggle'],
            [
                'is_enabled'  => true,
                'description' => 'Master switch for customer feedback collection',
                'updated_by'  => 1,
            ]
        );

        return response()->json([
            'is_enabled' => (bool) $setting->is_enabled,
            'isEnabled'  => (bool) $setting->is_enabled,
            'updated_at' => $setting->updated_at?->toIso8601String(),
        ]);
    }

    /**
     * Update the master feedback form enabled/disabled status.
     */
    public function toggleStatus(Request $request)
    {
        $setting = FeedbackFormSetting::firstOrCreate(
            ['key' => 'master_toggle'],
            [
                'is_enabled'  => true,
                'description' => 'Master switch for customer feedback collection',
                'updated_by'  => 1,
            ]
        );

        $targetEnabled = $request->has('is_enabled')
            ? (bool) $request->input('is_enabled')
            : ($request->has('isEnabled') ? (bool) $request->input('isEnabled') : !$setting->is_enabled);

        $userId = $request->user()?->emp_id
            ?? $request->user()?->id
            ?? DB::table('employees')->where('role', 'superadmin')->value('emp_id')
            ?? DB::table('employees')->value('emp_id')
            ?? 1;

        $setting->update([
            'is_enabled' => $targetEnabled,
            'updated_by' => $userId,
        ]);

        $actionWord = $targetEnabled ? 'enabled' : 'disabled';

        $this->logAudit(
            $request,
            'config_update',
            'Master Toggle',
            $actionWord,
            "Feedback form master switch {$actionWord} by Super Admin"
        );

        try {
            event(new FeedbackFormStatusUpdated($targetEnabled));
        } catch (\Throwable $e) {
            Log::warning("Failed to broadcast FeedbackFormStatusUpdated event: " . $e->getMessage());
        }

        return response()->json([
            'message'    => "Customer feedback form has been {$actionWord} successfully.",
            'is_enabled' => $targetEnabled,
            'isEnabled'  => $targetEnabled,
            'updated_at' => $setting->fresh()->updated_at?->toIso8601String(),
        ]);
    }


    // -------------------------------------------------------------------------
    // Per-category feedback toggle (stored in feedback_form_settings with namespaced key)
    // -------------------------------------------------------------------------

    /**
     * Get all per-category feedback enabled states.
     * Returns { categories: { [name]: boolean } }
     */
    public function getCategoryToggles()
    {
        $rows = \App\Models\FeedbackFormSetting::where('key', 'like', 'feedback_category:%')->get();

        $categories = [];
        foreach ($rows as $row) {
            $catName = substr($row->key, strlen('feedback_category:'));
            $categories[$catName] = (bool) $row->is_enabled;
        }

        return response()->json([
            'categories' => $categories,
        ]);
    }

    /**
     * Set the per-category feedback enabled state for a single category.
     * Body: { category: string, is_enabled: boolean }
     */
    public function setCategoryToggle(Request $request)
    {
        $validated = $request->validate([
            'category'   => 'required|string|max:100',
            'is_enabled' => 'required|boolean',
        ]);

        $category = trim($validated['category']);
        $isEnabled = (bool) $validated['is_enabled'];
        $key = "feedback_category:{$category}";

        $userId = $request->user()?->emp_id
            ?? $request->user()?->id
            ?? DB::table('employees')->where('role', 'superadmin')->value('emp_id')
            ?? DB::table('employees')->value('emp_id')
            ?? 1;

        $setting = \App\Models\FeedbackFormSetting::firstOrCreate(
            ['key' => $key],
            [
                'is_enabled'  => true,
                'description' => "Per-category feedback toggle for '{$category}'",
                'updated_by'  => $userId,
            ]
        );

        $setting->update([
            'is_enabled' => $isEnabled,
            'updated_by' => $userId,
        ]);

        $actionWord = $isEnabled ? 'enabled' : 'disabled';

        $this->logAudit(
            $request,
            'config_update',
            $category,
            $actionWord,
            "Feedback form for category '{$category}' {$actionWord} by Super Admin"
        );

        $this->dispatchUpdateEvent($category, "category_{$actionWord}", []);

        return response()->json([
            'message'    => "Feedback form for '{$category}' has been {$actionWord}.",
            'category'   => $category,
            'is_enabled' => $isEnabled,
            'isEnabled'  => $isEnabled,
        ]);
    }

    /**
     * Disable feedback for a category (called when an equipment category is deleted).
     * Does NOT delete historical questions or responses — only disables future feedback collection.
     */
    public function disableCategory(Request $request)
    {
        $validated = $request->validate([
            'category' => 'required|string|max:100',
        ]);

        $category = trim($validated['category']);
        $key = "feedback_category:{$category}";

        $userId = $request->user()?->emp_id
            ?? $request->user()?->id
            ?? DB::table('employees')->where('role', 'superadmin')->value('emp_id')
            ?? DB::table('employees')->value('emp_id')
            ?? 1;

        \App\Models\FeedbackFormSetting::updateOrCreate(
            ['key' => $key],
            [
                'is_enabled'  => false,
                'description' => "Per-category feedback toggle for '{$category}' (auto-disabled on category deletion)",
                'updated_by'  => $userId,
            ]
        );

        $this->logAudit(
            $request,
            'config_update',
            $category,
            'disabled',
            "Feedback for category '{$category}' auto-disabled after equipment category deletion"
        );

        return response()->json([
            'message'    => "Feedback collection for '{$category}' disabled. Historical data is preserved.",
            'category'   => $category,
            'is_enabled' => false,
        ]);
    }
}
