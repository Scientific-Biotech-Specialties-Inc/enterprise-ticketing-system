<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GeminiService
{
    protected string $apiKey;
    protected string $model;
    protected string $baseUrl;
    protected int $timeout;
    protected RagService $ragService;

    public function __construct(?RagService $ragService = null)
    {
        $this->apiKey = config('services.gemini.api_key') ?? env('GEMINI_API_KEY', '');
        $this->model = config('services.gemini.model') ?? env('GEMINI_MODEL', 'gemini-3.5-flash');
        // Spec 0036 (AC-10): at most 15 seconds, then escalate to a manual ticket.
        $this->timeout = max(1, min((int) config('services.gemini.timeout', 15), 15));
        $this->baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
        $this->ragService = $ragService ?? app(RagService::class);
    }

    /**
     * Generate support response from Google Gemini with grounded RAG on published articles
     * and automatic fallback to ticket creation when no published articles match.
     *
     * @param array $messages Array of {role: string, content: string}
     * @param string|null $conversationId
     * @return array {content: string, escalate: bool, ticket_data: array|null, rag_matched: bool, rag_sources: array}
     */
    public function generateResponse(array $messages, ?string $conversationId = null): array
    {
        $requestStartTime = hrtime(true);

        // 1. Extract the latest customer query
        $lastUserQuery = '';
        foreach (array_reverse($messages) as $m) {
            if (($m['role'] ?? '') === 'user' && !empty($m['content'])) {
                $lastUserQuery = trim($m['content']);
                break;
            }
        }

        $isGreeting = $this->isGreetingOnly($lastUserQuery);

        // TS050 Safety Guardrail: Detect dangerous high-voltage electrical or heavy machinery physical internal repair
        if (!empty($lastUserQuery) && $this->detectHazardousRepairIntent($lastUserQuery)) {
            Log::warning('TS050 Safety Guardrail triggered: Dangerous high-voltage or heavy machinery repair inquiry intercepted.', [
                'query' => $lastUserQuery,
            ]);
            $title = $this->deriveTitleFromMessages($messages) ?: 'Urgent: High-Voltage / Machinery Physical Inspection Needed';
            $dangerNotice = "⚠️ SAFETY HAZARD ALERT: For your safety, do not attempt to service, disassemble, or touch live high-voltage electrical components, open electrical cabinets, or bypass safety interlocks on heavy machinery.\n\nPhysical intervention on high-voltage and industrial machinery must strictly be handled by certified service engineers with proper lockout/tagout procedures. I have escalated this issue directly to a high-priority technician dispatch ticket.";

            return [
                'content' => $dangerNotice,
                'reply' => $dangerNotice,
                'escalate' => true,
                'is_fallback' => true,
                'fallback' => true,
                'safety_alert' => true,
                'ticket_data' => [
                    'title' => $title,
                    'description' => $lastUserQuery . " [SAFETY ESCALATION: Hazardous high-voltage or heavy equipment repair inquiry]",
                    'priority' => 'High',
                    'suggested_category' => 'Hardware',
                    'category_confidence' => 0.95,
                ],
                'ticket_title' => $title,
                'ticket_description' => $lastUserQuery . " [SAFETY ESCALATION: Hazardous high-voltage or heavy equipment repair inquiry]",
                'rag_matched' => false,
                'rag_sources' => [],
                'rag_duration_ms' => 0.0,
                'total_duration_ms' => round((hrtime(true) - $requestStartTime) / 1e6, 2),
            ];
        }

        // 2. Perform RAG retrieval strictly over Published articles
        $ragResult = [
            'chunks' => [],
            'duration_ms' => 0.0,
            'matched' => false,
        ];

        if (!empty($lastUserQuery) && !$isGreeting) {
            // Spec 0036 (AC-8): threshold from KB_MIN_SCORE. If the query cannot be embedded we do not
            // fall back to any other vector space; the customer goes straight to the manual ticket path.
            try {
                $ragResult = $this->ragService->retrieve($lastUserQuery, 5);
            } catch (\App\Exceptions\EmbeddingFailedException $e) {
                Log::warning('RAG query embedding failed. Escalating to manual ticket creation.', ['reason' => $e->getMessage()]);
                return $this->fallbackToManual($messages, 'Query embedding failed: ' . $e->getMessage());
            }

            // =========================================================================
            // FALLBACK PATH: No Published article matched customer query
            // =========================================================================
            if (!$ragResult['matched']) {
                $title = $this->deriveTitleFromMessages($messages);
                Log::info('RAG query yielded no published matches. Triggering ticket creation fallback path.', [
                    'query' => $lastUserQuery,
                    'derived_title' => $title,
                    'rag_duration_ms' => $ragResult['duration_ms'],
                ]);

                $replyText = "I searched our approved Knowledge Base and official documentation, but could not find any published articles or procedures matching your specific issue.\n\nTo ensure you receive accurate, manufacturer-approved technical assistance, I have prepared a support ticket request so our certified technical engineering team can inspect and resolve this for you directly.";
                return [
                    'content' => $replyText,
                    'reply' => $replyText,
                    'escalate' => true,
                    'is_fallback' => true,
                    'fallback' => true,
                    'ticket_data' => [
                        'title' => $title,
                        'description' => !empty($lastUserQuery) ? $lastUserQuery : 'Customer inquiry required technical assistance beyond published documentation.',
                    ],
                    'ticket_title' => $title,
                    'ticket_description' => !empty($lastUserQuery) ? $lastUserQuery : 'Customer inquiry required technical assistance beyond published documentation.',
                    'rag_matched' => false,
                    'rag_sources' => [],
                    'rag_duration_ms' => $ragResult['duration_ms'],
                    'total_duration_ms' => round((hrtime(true) - $requestStartTime) / 1e6, 2),
                ];
            }
        }

        // 3. Fallback to manual if Gemini API key is missing
        if (empty($this->apiKey)) {
            Log::warning('GEMINI_API_KEY is not configured in services.gemini. Falling back to manual ticket creation.');
            return $this->fallbackToManual($messages, 'AI assistant is not configured with an API key.');
        }

        try {
            $url = "{$this->baseUrl}/{$this->model}:generateContent";

            // 4. Construct System Instruction with Published Article Sources Grounding
            $systemInstruction = "You are an expert enterprise technical support AI assistant for an industrial, equipment, and IT ticketing platform. " .
                "Your objective is to guide customers through clear, step-by-step diagnostic and troubleshooting actions for their machines, hardware, or software problems.\n\n" .
                "Key Guidelines:\n" .
                "1. Format all troubleshooting steps clearly using numbered step headers: `Step 1: **[Short Action Title]** — [Clear, actionable instruction]`, `Step 2: **[Short Action Title]** — [Instruction]`, etc. (3 to 5 concise steps, under 180 words total). Always include expected outcome or verification at the final step.\n" .
                "2. Base your guidance strictly on the approved published documentation provided below. If multiple articles or procedures are provided, prioritize the most recently updated procedure and provide the numbered troubleshooting steps in chronological order. Never invent, hallucinate, or reference draft or archived procedures.\n" .
                "3. If the user indicates that basic troubleshooting failed, or if the issue involves dangerous high-voltage electrical, jammed heavy machinery, broken hardware, or requires an on-site technician dispatch, you MUST recommend escalating to a support ticket.\n" .
                "4. When escalating, append a structured JSON block at the very end of your response exactly like this:\n" .
                "```json\n" .
                "{\n" .
                '  "escalate": true,' . "\n" .
                '  "ticket_title": "Concise natural summary of the problem (e.g. Ultrasound System Calibration Error, NEVER include numbers or bullets like 1. or 2.)",' . "\n" .
                '  "ticket_description": "Detailed human-readable summary of the problem and troubleshooting attempted",' . "\n" .
                '  "suggested_category": "Classified category name or null if not confident (e.g. Hardware, Software, Network)",' . "\n" .
                '  "category_confidence": 0.85,' . "\n" .
                '  "suggested_machine": "Specific machine name or serial number mentioned by user or null if not identified",' . "\n" .
                '  "machine_confidence": 0.90' . "\n" .
                "}\n" .
                "```";

            if (!empty($ragResult['chunks'])) {
                $systemInstruction .= "\n\n=== APPROVED PUBLISHED KNOWLEDGE BASE SOURCES ===\n";
                foreach ($ragResult['chunks'] as $idx => $chunk) {
                    $num = $idx + 1;
                    $updatedStr = !empty($chunk['article_updated_at']) ? " | Last Updated: " . date('Y-m-d H:i', strtotime($chunk['article_updated_at'])) : "";
                    $systemInstruction .= "Source {$num}: [{$chunk['article_title']} | {$chunk['article_category']}" . (!empty($chunk['article_machine']) ? " | {$chunk['article_machine']}" : "") . "{$updatedStr}]\n" .
                        $chunk['content'] . "\n\n";
                }
                $systemInstruction .= "=== END APPROVED SOURCES ===\n";
                $systemInstruction .= "INSTRUCTION: Directly cite or summarize the approved steps from the sources above to resolve the user's issue.";
            }

            // Limit conversation window to latest 8 messages to prevent latency degradation in long chats
            $recentMessages = count($messages) > 8 ? array_slice($messages, -8) : $messages;

            // Format contents for Gemini API (roles: 'user' and 'model')
            $contents = [];
            foreach ($recentMessages as $msg) {
                $role = ($msg['role'] === 'assistant' || $msg['role'] === 'ai' || $msg['role'] === 'model') ? 'model' : 'user';
                $text = is_string($msg['content'] ?? null) ? trim($msg['content']) : '';
                if (!empty($text)) {
                    $contents[] = [
                        'role' => $role,
                        'parts' => [
                            ['text' => $text]
                        ]
                    ];
                }
            }

            if (empty($contents)) {
                $contents[] = [
                    'role' => 'user',
                    'parts' => [['text' => 'Hello, I need assistance with an equipment issue.']]
                ];
            }

            $payload = [
                'systemInstruction' => [
                    'parts' => [
                        ['text' => $systemInstruction]
                    ]
                ],
                'contents' => $contents,
                // Thinking tokens count against maxOutputTokens and add seconds of latency, which cut
                // replies off mid JSON. Troubleshooting steps grounded in KB sources do not need it.
                'generationConfig' => $this->withThinkingOff([
                    'temperature' => 0.2,
                    // Room for 3 to 5 steps plus the escalation JSON block, so the block is not cut off.
                    'maxOutputTokens' => 1024,
                ]),
            ];

            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'x-goog-api-key' => $this->apiKey,
            ])->connectTimeout(5)->timeout($this->timeout)->post($url, $payload);

            if (!$response->successful()) {
                Log::error('Gemini API request failed', [
                    'status' => $response->status(),
                    'body' => $response->body()
                ]);
                return $this->fallbackToManual($messages, 'Gemini API returned error: ' . $response->status());
            }

            $responseData = $response->json();
            $rawText = $responseData['candidates'][0]['content']['parts'][0]['text'] ?? '';

            if (empty($rawText)) {
                return $this->fallbackToManual($messages, 'Empty response from Gemini.');
            }

            $totalDurationMs = round((hrtime(true) - $requestStartTime) / 1e6, 2);

            // Latency target audit: verify total request time is under 5 seconds (5000ms)
            if ($totalDurationMs > 5000.0) {
                Log::warning('Chatbot response exceeded 5-second target threshold', [
                    'total_duration_ms' => $totalDurationMs,
                    'rag_duration_ms' => $ragResult['duration_ms'],
                ]);
            } else {
                Log::info('Chatbot response delivered within 5-second target', [
                    'total_duration_ms' => $totalDurationMs,
                    'rag_duration_ms' => $ragResult['duration_ms'],
                ]);
            }

            $parsed = $this->parseResponse($rawText, $messages);
            $parsed['rag_matched'] = $ragResult['matched'];
            $parsed['rag_sources'] = array_map(fn ($c) => [
                'title' => $c['article_title'],
                'category' => $c['article_category'],
                'machine' => $c['article_machine'],
                'score' => $c['score'],
                'updated_at' => $c['article_updated_at'] ?? null,
            ], $ragResult['chunks']);
            $parsed['rag_duration_ms'] = $ragResult['duration_ms'];
            $parsed['total_duration_ms'] = $totalDurationMs;

            return $parsed;

        } catch (\Throwable $e) {
            Log::error('GeminiService exception: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
            return $this->fallbackToManual($messages, $e->getMessage());
        }
    }

    /**
     * Parse Gemini response for escalation JSON or explicit escalation keywords.
     */
    protected function parseResponse(string $rawText, array $messages): array
    {
        $escalate = false;
        $ticketData = null;
        $cleanText = $rawText;

        // Find the escalation JSON block wherever it starts. Gemini does not always close it (the
        // reply can hit the token limit mid block), tag it as json, or fence it at all, so match on
        // the opening `{ "escalate":` and treat everything from there to the end as machine data.
        // That data is never shown to the customer, even when it cannot be decoded.
        if (preg_match('/(?:```[a-zA-Z]*\s*)?\{\s*"escalate"\s*:/', $rawText, $start, PREG_OFFSET_CAPTURE)) {
            $offset = $start[0][1];
            $block = substr($rawText, $offset);
            $cleanText = trim(substr($rawText, 0, $offset));

            $jsonStr = preg_replace('/^```[a-zA-Z]*\s*/', '', $block);
            $lastBrace = strrpos($jsonStr, '}');
            $parsed = $lastBrace !== false ? json_decode(substr($jsonStr, 0, $lastBrace + 1), true) : null;
            if (!is_array($parsed)) {
                $parsed = $this->extractPartialEscalationFields($jsonStr);
            }

            $escalate = ($parsed['escalate'] ?? false) === true;
            if ($escalate) {
                $rawTitle = $parsed['ticket_title'] ?? '';
                $cleanTitle = preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $rawTitle);
                $cleanTitle = trim($cleanTitle);
                $ticketData = [
                    'title' => !empty($cleanTitle) ? ucfirst($cleanTitle) : $this->deriveTitleFromMessages($messages),
                    'description' => $parsed['ticket_description'] ?? 'Submitted via AI Support Assistant.',
                    'category' => !empty($parsed['suggested_category']) && strtolower($parsed['suggested_category']) !== 'null' ? trim($parsed['suggested_category']) : null,
                    'category_confidence' => isset($parsed['category_confidence']) ? (float) $parsed['category_confidence'] : 0.85,
                    'machine' => !empty($parsed['suggested_machine']) && strtolower($parsed['suggested_machine']) !== 'null' ? trim($parsed['suggested_machine']) : null,
                    'machine_confidence' => isset($parsed['machine_confidence']) ? (float) $parsed['machine_confidence'] : 0.85,
                ];
            }
        } else {
            // Fallback keyword check for escalation
            $lower = strtolower($rawText);
            if (
                str_contains($lower, 'create a support ticket') ||
                str_contains($lower, 'open a ticket') ||
                str_contains($lower, 'technician will need to inspect') ||
                str_contains($lower, 'dispatch a technician')
            ) {
                $escalate = true;
                $ticketData = [
                    'title' => $this->deriveTitleFromMessages($messages),
                    'description' => 'Automated troubleshooting suggested technician dispatch for this issue.',
                    'category' => null,
                    'category_confidence' => 0.0,
                    'machine' => null,
                    'machine_confidence' => 0.0,
                ];
            }
        }

        return [
            'content' => $cleanText,
            'escalate' => $escalate,
            'ticket_data' => $ticketData,
        ];
    }

    /**
     * Recover the fields that survived from an escalation block that is not valid JSON
     * (usually cut off by the output token limit). Only complete key/value pairs are kept.
     */
    protected function extractPartialEscalationFields(string $text): array
    {
        $fields = [];
        preg_match_all('/"([a-z_]+)"\s*:\s*("(?:[^"\\\\]|\\\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/i', $text, $pairs, PREG_SET_ORDER);
        foreach ($pairs as $pair) {
            $fields[$pair[1]] = json_decode($pair[2], true);
        }

        return $fields;
    }

    /**
     * Graceful fallback when Gemini is unavailable.
     */
    protected function fallbackToManual(array $messages, string $reason): array
    {
        $lastUserMsg = '';
        foreach (array_reverse($messages) as $m) {
            if (($m['role'] ?? '') === 'user' && !empty($m['content'])) {
                $lastUserMsg = $m['content'];
                break;
            }
        }

        $cleanedMsg = preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $lastUserMsg);
        $title = !empty($cleanedMsg) ? ucfirst(mb_substr(trim($cleanedMsg), 0, 60)) : 'Technical Support Request';

        $replyText = "Our automated AI support assistant is temporarily unavailable. " .
            "Please proceed to create a support ticket directly below, and our technical engineering team will review and resolve your issue shortly.";

        return [
            'content' => $replyText,
            'reply' => $replyText,
            'escalate' => true,
            'is_fallback' => true,
            'ticket_data' => [
                'title' => $title,
                'description' => !empty($lastUserMsg) ? $lastUserMsg : 'Submitted via manual support ticket.',
            ],
            'ticket_title' => $title,
            'ticket_description' => !empty($lastUserMsg) ? $lastUserMsg : 'Submitted via manual support ticket.',
            'fallback' => true,
            'reason' => $reason,
            'rag_matched' => false,
            'rag_sources' => [],
        ];
    }

    /**
     * Derive a concise title from the user messages, ignoring pure greetings.
     */
    protected function deriveTitleFromMessages(array $messages): string
    {
        $greetings = [
            'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
            'good day', 'greetings', 'help', 'test', 'support', 'hi there', 'hello there',
            'ok', 'okay', 'yes', 'no', 'thanks', 'thank you', 'please help'
        ];

        foreach ($messages as $m) {
            if (($m['role'] ?? '') === 'user' && !empty($m['content'])) {
                $content = trim($m['content']);
                $cleaned = trim(preg_replace('/[^\w\s]/', '', strtolower($content)));

                if (in_array($cleaned, $greetings, true)) {
                    continue;
                }

                foreach ($greetings as $g) {
                    if (str_starts_with($cleaned, $g . ' ')) {
                        $content = trim(substr($content, strlen($g)));
                        $content = ltrim($content, " ,.!?-");
                        break;
                    }
                }

                // A numbered intake answer ("1. machine 2. model ... 4. symptom") becomes "symptom (model)".
                $intakeTitle = IntakeTitleBuilder::fromNumberedIntake($content);
                if ($intakeTitle !== null) {
                    return $intakeTitle;
                }

                // Strip question numbers like "1.", "1)", "1 -", "Q1:", "Machine:"
                $content = preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $content);
                $content = trim($content);

                if (!empty($content) && mb_strlen($content) >= 3) {
                    $cleanedTitle = mb_substr($content, 0, 60);
                    return ucfirst($cleanedTitle);
                }
            }
        }
        return 'Equipment Technical Support Request';
    }

    public function isGreetingOnly(string $text): bool
    {
        $greetings = [
            'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
            'good day', 'greetings', 'help', 'test', 'support', 'hi there', 'hello there'
        ];
        $cleaned = trim(preg_replace('/[^\w\s]/', '', strtolower($text)));
        return in_array($cleaned, $greetings, true);
    }

    /**
     * TS050 Safety Guardrails: Identify dangerous high-voltage electrical or heavy machinery physical internal repair.
     */
    public function detectHazardousRepairIntent(string $query): bool
    {
        $q = strtolower(trim($query));
        $dangerKeywords = [
            'high voltage',
            'high-voltage',
            'live wire',
            'live wiring',
            'electric shock',
            'electrocution',
            'open transformer',
            'touch transformer',
            'bypass interlock',
            'bypass safety interlock',
            'repair capacitor',
            'discharge capacitor',
            'heavy machinery gear repair',
            'internal gear assembly',
            'hydraulic press repair',
            'running roller bypass',
            'reach inside gear',
            'service live power board',
        ];

        foreach ($dangerKeywords as $keyword) {
            if (str_contains($q, $keyword)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Classify whether a ticket issue belongs to IT (software/digital) or Service (hardware/machinery).
     */
    public function classifyDepartment(string $title, string $description): array
    {
        // Try Gemini if API key is present
        if (!empty($this->apiKey)) {
            try {
                $url = "{$this->baseUrl}/{$this->model}:generateContent";
                $systemInstruction = "You are an enterprise hospital and clinic IT/Service desk triage assistant.\n"
                    . "Your job is to classify incoming support tickets into one of two departments:\n"
                    . "1. 'IT': For software, applications, portals, account access, login/passwords, network/WiFi/internet, database, EHR/EMR, UI bugs, server errors, digital system timeouts, or operating system issues. Software issues DO NOT require physical equipment/hardware.\n"
                    . "2. 'Service': For physical medical machines, hardware breakdown, scanning equipment (MRI, CT, X-Ray), bedside monitors, sensors, physical cables, motors, physical damage, calibration, power supplies, or mechanical failures. Hardware issues REQUIRE physical equipment selection.\n\n"
                    . "You must output strictly a raw JSON object with no markdown formatting:\n"
                    . "{\"department\": \"IT\" or \"Service\", \"is_software\": true or false, \"confidence\": 0.90, \"reasoning\": \"1 concise sentence explaining the classification to the customer.\"}";

                $payload = [
                    'systemInstruction' => [
                        'parts' => [['text' => $systemInstruction]]
                    ],
                    'contents' => [
                        [
                            'role' => 'user',
                            'parts' => [['text' => "Ticket Title: {$title}\nDescription: {$description}"]]
                        ]
                    ],
                    'generationConfig' => $this->withThinkingOff([
                        'temperature' => 0.1,
                        'maxOutputTokens' => 200,
                    ]),
                ];

                $response = Http::withHeaders(['Content-Type' => 'application/json', 'x-goog-api-key' => $this->apiKey])
                    ->timeout(6)
                    ->post($url, $payload);

                if ($response->successful()) {
                    $raw = $response->json('candidates.0.content.parts.0.text') ?? '';
                    if (preg_match('/\{[\s\S]*\}/', $raw, $m)) {
                        $data = json_decode($m[0], true);
                        if (is_array($data) && isset($data['department'])) {
                            $dept = strtoupper(trim($data['department'])) === 'IT' ? 'IT' : 'Service';
                            $isSoftware = $dept === 'IT' || (!empty($data['is_software']) && $data['is_software'] === true);
                            if ($isSoftware) $dept = 'IT';
                            return [
                                'department' => $dept,
                                'department_id' => $dept === 'IT' ? 2 : 1,
                                'is_software' => $dept === 'IT',
                                'requires_equipment' => $dept !== 'IT',
                                'confidence' => isset($data['confidence']) ? (float) $data['confidence'] : 0.9,
                                'reasoning' => $data['reasoning'] ?? ($dept === 'IT'
                                    ? 'This issue relates to software or digital systems. Physical equipment selection is optional.'
                                    : 'This issue involves physical hardware or machinery inspection. Equipment selection is required.'),
                                'source' => 'gemini'
                            ];
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Gemini department classification failed, falling back to heuristics: ' . $e->getMessage());
            }
        }

        // Resilient heuristic classification fallback
        return $this->heuristicClassifyDepartment($title, $description);
    }

    /**
     * Turn Gemini thinking off in a way the configured model accepts.
     *
     * Full flash models think by default and need `thinkingBudget: 0`, or thinking eats the token
     * budget (MAX_TOKENS, 10s+). Flash lite models do not think by default and reject
     * `thinkingBudget: 0` with HTTP 400 INVALID_ARGUMENT, so they get no thinking setting at all.
     */
    protected function withThinkingOff(array $generationConfig): array
    {
        if (!str_contains(strtolower((string) $this->model), 'lite')) {
            $generationConfig['thinkingConfig'] = ['thinkingBudget' => 0];
        }

        return $generationConfig;
    }

    /**
     * Suggest which problem category a ticket belongs to, choosing only from the supplied list.
     *
     * There is deliberately no keyword fallback: when Gemini is unavailable, errors, or is not
     * confident, category_id is null and the customer picks manually (no local fallback model).
     *
     * @param  array<int, array{id:int|string, name:string}>  $categories
     * @return array{category_id: int|string|null, confidence: float, reasoning: string, source: string}
     */
    public function classifyCategory(string $title, string $description, array $categories, float $minConfidence = 0.6): array
    {
        $none = ['category_id' => null, 'confidence' => 0.0, 'reasoning' => '', 'source' => 'none'];

        if (empty($this->apiKey) || empty($categories)) {
            return $none;
        }

        $byId = [];
        $lines = [];
        foreach ($categories as $c) {
            $byId[(string) $c['id']] = $c['id'];
            $lines[] = "{$c['id']}: {$c['name']}";
        }

        try {
            $url = "{$this->baseUrl}/{$this->model}:generateContent";
            $systemInstruction = "You are an enterprise hospital and clinic IT/Service desk triage assistant.\n"
                . "Choose the single best problem category for the support ticket from this list only (format 'id: name'):\n"
                . implode("\n", $lines) . "\n\n"
                . "If none clearly fits, set category_id to null. Never invent an id.\n"
                . "Output strictly a raw JSON object with no markdown:\n"
                . "{\"category_id\": <id from the list or null>, \"confidence\": 0.90, \"reasoning\": \"1 concise sentence.\"}";

            $response = Http::withHeaders(['Content-Type' => 'application/json', 'x-goog-api-key' => $this->apiKey])
                ->timeout(6)
                ->post($url, [
                    'systemInstruction' => ['parts' => [['text' => $systemInstruction]]],
                    'contents' => [[
                        'role' => 'user',
                        'parts' => [['text' => "Ticket Title: {$title}\nDescription: {$description}"]],
                    ]],
                    // No thinking: it used half the 200 token budget and pushed replies past the 6s timeout.
                    'generationConfig' => $this->withThinkingOff(['temperature' => 0.1, 'maxOutputTokens' => 200]),
                ]);

            if (!$response->successful()) {
                Log::warning('Gemini category classification returned HTTP ' . $response->status() . '; leaving category unclassified.');
            }

            if ($response->successful()) {
                $raw = $response->json('candidates.0.content.parts.0.text') ?? '';
                if (preg_match('/\{[\s\S]*\}/', $raw, $m)) {
                    $data = json_decode($m[0], true);
                    $picked = is_array($data) ? ($data['category_id'] ?? null) : null;
                    $confidence = (float) ($data['confidence'] ?? 0);

                    // Only accept an id that really is in the supplied list, with enough confidence.
                    if ($picked !== null && isset($byId[(string) $picked]) && $confidence >= $minConfidence) {
                        return [
                            'category_id' => $byId[(string) $picked],
                            'confidence' => $confidence,
                            'reasoning' => (string) ($data['reasoning'] ?? ''),
                            'source' => 'gemini',
                        ];
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Gemini category classification failed; leaving category for manual selection: ' . $e->getMessage());
        }

        return $none;
    }

    /**
     * Resilient keyword based heuristic classification when AI is unavailable or offline.
     */
    public function heuristicClassifyDepartment(string $title, string $description): array
    {
        $text = strtolower($title . ' ' . $description);

        $softwareKeywords = [
            'software', 'app', 'application', 'login', 'logout', 'password', 'auth', 'account', 'user',
            'portal', 'permission', 'role', 'bug', 'glitch', 'crash', 'freeze', 'freezing', 'ui', 'interface',
            'network', 'wifi', 'wi-fi', 'internet', 'connection', 'timeout', 'database', 'sql', 'query',
            'sync', 'syncing', 'update', 'upgrade', 'install', 'installation', 'browser', 'chrome', 'license',
            'api', 'slow system', 'page error', '404', '500', 'code', 'script', 'export', 'import', 'csv',
            'pdf generation', 'email notification', 'reset password', 'credential', 'dashboard'
        ];

        $hardwareKeywords = [
            'machine', 'hardware', 'scanner', 'mri', 'ct scan', 'xray', 'x-ray', 'monitor', 'bedside',
            'sensor', 'cable', 'cord', 'power supply', 'outlet', 'smoke', 'burnt', 'leak', 'water',
            'noise', 'vibration', 'motor', 'fan', 'broken', 'cracked', 'physical', 'lens', 'pump',
            'valve', 'calibration', 'cartridge', 'tray', 'arm', 'wheel', 'plug', 'battery', 'overheating'
        ];

        $softwareScore = 0;
        foreach ($softwareKeywords as $word) {
            if (str_contains($text, $word)) {
                $softwareScore++;
            }
        }

        $hardwareScore = 0;
        foreach ($hardwareKeywords as $word) {
            if (str_contains($text, $word)) {
                $hardwareScore++;
            }
        }

        $isSoftware = ($softwareScore >= $hardwareScore && $softwareScore > 0) || ($softwareScore > 0 && $hardwareScore === 0);
        $dept = $isSoftware ? 'IT' : 'Service';

        return [
            'department' => $dept,
            'department_id' => $dept === 'IT' ? 2 : 1,
            'is_software' => $dept === 'IT',
            'requires_equipment' => $dept !== 'IT',
            'confidence' => $isSoftware ? 0.85 : 0.80,
            'reasoning' => $dept === 'IT'
                ? 'Your problem description indicates a software or digital system issue. Physical equipment is optional.'
                : 'Your problem description indicates physical machinery or hardware maintenance. Equipment selection is required.',
            'source' => 'heuristic'
        ];
    }
}
