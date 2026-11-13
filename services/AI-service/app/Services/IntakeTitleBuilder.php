<?php

namespace App\Services;

/**
 * Builds a readable ticket title from a numbered diagnostic intake answer.
 *
 * The chat page asks customers for: 1. machine name, 2. brand and model, 3. serial number,
 * 4. symptom or error code, 5. prior troubleshooting, usually all in one message. Taking the first
 * characters of that message produced titles like "Yumizen 2. Mindray BC-5390 3. SN-TEST-00417 4. Results From".
 * This picks the symptom and the model instead, e.g. "Results from the analyzer aren't reaching the LIS (Mindray BC-5390)".
 */
class IntakeTitleBuilder
{
    private const MAX_SYMPTOM_LENGTH = 70;

    private const EMPTY_ANSWERS = ['n/a', 'na', 'none', 'not available', 'unknown', '-'];

    /**
     * Returns null when the text is not a numbered intake answer, so callers keep their usual title logic.
     */
    public static function fromNumberedIntake(string $text): ?string
    {
        $answers = self::splitNumberedAnswers($text);
        if ($answers === null) {
            return null;
        }

        $symptomKey = isset($answers[4]) ? 4 : self::longestAnswerKey($answers);
        $symptom = $symptomKey !== null ? self::shortenSymptom($answers[$symptomKey]) : '';

        $equipment = '';
        foreach ([2, 1] as $key) {
            // Customers sometimes skip a step, so a serial number can land in the model slot.
            if ($key !== $symptomKey && isset($answers[$key]) && !preg_match('/^(?:s\/?n|serial)\b|^sn-/i', $answers[$key])) {
                $equipment = $answers[$key];
                break;
            }
        }

        if ($symptom === '' && $equipment === '') {
            return null;
        }
        if ($symptom === '') {
            return self::capitalize($equipment) . ' Technical Support Request';
        }
        if ($equipment === '' || mb_stripos($symptom, $equipment) !== false) {
            return self::capitalize($symptom);
        }

        return self::capitalize($symptom) . ' (' . $equipment . ')';
    }

    /**
     * Splits "1. foo 2. bar" (inline or one per line) into [1 => 'foo', 2 => 'bar'].
     * Needs at least two answers and a list that starts at 1, so ordinary text with a stray number is ignored.
     *
     * @return array<int, string>|null
     */
    private static function splitNumberedAnswers(string $text): ?array
    {
        $count = preg_match_all(
            '/(?:^|\s)(\d{1,2})[.)]\s+(.*?)(?=\s+\d{1,2}[.)]\s+|\s*$)/s',
            trim($text),
            $matches,
            PREG_SET_ORDER
        );

        if ($count < 2 || (int) $matches[0][1] !== 1) {
            return null;
        }

        $answers = [];
        foreach ($matches as $match) {
            $value = self::stripIntakeLabel(trim(preg_replace('/\s+/', ' ', $match[2])));
            if ($value !== '' && !in_array(mb_strtolower(rtrim($value, '.')), self::EMPTY_ANSWERS, true)) {
                $answers[(int) $match[1]] = $value;
            }
        }

        return count($answers) > 0 ? $answers : null;
    }

    /**
     * Removes a label the customer copied from the guide, e.g. "Brand & Model: Mindray BC-5390".
     */
    private static function stripIntakeLabel(string $value): string
    {
        return trim(preg_replace(
            '/^[\w\/&\s]{0,25}?(?:machine|equipment|brand|model|serial|s\/n|symptom|issue|problem|fault|troubleshooting)(?:\s*name|\s*number|\s*code)?\s*[:\-]\s*/i',
            '',
            $value
        ));
    }

    /**
     * @param array<int, string> $answers
     */
    private static function longestAnswerKey(array $answers): ?int
    {
        $bestKey = null;
        $bestWords = 2; // a symptom is a phrase, not a model name or serial

        foreach ($answers as $key => $value) {
            $words = count(preg_split('/\s+/', $value));
            if ($words > $bestWords) {
                $bestKey = $key;
                $bestWords = $words;
            }
        }

        return $bestKey;
    }

    /**
     * Keeps the first sentence and cuts long text at a word boundary.
     */
    private static function shortenSymptom(string $symptom): string
    {
        $first = preg_split('/(?<=[.!?])\s+/', $symptom)[0] ?? $symptom;
        $first = rtrim(trim($first), '.!?;, ');

        if (mb_strlen($first) <= self::MAX_SYMPTOM_LENGTH) {
            return $first;
        }

        $cut = mb_substr($first, 0, self::MAX_SYMPTOM_LENGTH);
        $lastSpace = mb_strrpos($cut, ' ');

        return rtrim($lastSpace !== false ? mb_substr($cut, 0, $lastSpace) : $cut, ',;: ') . '...';
    }

    private static function capitalize(string $value): string
    {
        return mb_strtoupper(mb_substr($value, 0, 1)) . mb_substr($value, 1);
    }
}
