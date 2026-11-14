<?php

namespace App\Services;

/**
 * Spec 0043 (AC-6): turns the server classification into the stored category, machine,
 * and department for a new customer ticket.
 *
 * - No confident match: category NULL, no department (CS classifies it later, AC-20).
 * - Software: machine_ID is always cleared.
 * - Service without a machine: stored unclassified so the CS gate collects the machine.
 */
class TicketIntakeClassificationService
{
    public function __construct(
        protected TicketCategoryClassifier $classifier,
        protected CategoryDepartmentResolver $departments
    ) {}

    /**
     * @return array{problem_category_ID:?int, machine_ID:?int, department_id:?int}
     */
    public function classifyForCreate(array $validated, ?string $callerToken): array
    {
        $machineId = !empty($validated['machine_ID']) ? (int) $validated['machine_ID'] : null;

        $categoryId = $this->classifier->classify(
            (string) ($validated['title'] ?? ''),
            (string) ($validated['description'] ?? ''),
            $callerToken
        );

        return $this->apply($categoryId, $machineId);
    }

    /**
     * @return array{problem_category_ID:?int, machine_ID:?int, department_id:?int}
     */
    public function apply(?int $categoryId, ?int $machineId): array
    {
        if ($categoryId !== null && $this->departments->isSoftware($categoryId)) {
            $machineId = null;
        } elseif ($categoryId !== null && $this->departments->isService($categoryId) && $machineId === null) {
            $categoryId = null;
        }

        $department = $this->departments->resolve($categoryId);

        return [
            'problem_category_ID' => $categoryId,
            'machine_ID' => $machineId,
            'department_id' => $department['id'] ?? null,
        ];
    }
}
