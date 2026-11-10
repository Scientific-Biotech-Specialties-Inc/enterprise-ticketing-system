import React from 'react';
import { Check } from 'lucide-react';
import { STEPPER_STEPS, getStepIndex } from './ticketModalUtils';

/**
 * StatusStepper component
 * Submitted > Assigned > In Progress > Resolved
 * Completed = filled navy check
 * Current = bold navy label
 * Future = empty gray ring
 * Stays on one row on desktop and mobile
 */
export default function StatusStepper({
  status,
  isAssigned = false,
  steps = null,
  activeStepIndex = null,
  ringCurrentStep = true,
  className = '',
}) {
  const stepperSteps = steps || STEPPER_STEPS;
  const currentStepIndex = activeStepIndex !== null ? activeStepIndex : getStepIndex(status, isAssigned);

  return (
    <div className={`w-full py-1 ${className}`}>
      <div className="flex items-start justify-between w-full">
        {stepperSteps.map((step, idx) => {
          const isPriorCompleted = idx < currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          const isCurrentFinal = isCurrent && idx === stepperSteps.length - 1;
          const showCheck = isPriorCompleted || (isCurrentFinal && String(status || '').toLowerCase() === 'resolved');
          const showRing = isCurrent && ringCurrentStep && !showCheck;
          const hasNext = idx < stepperSteps.length - 1;
          const isNextCompleted = idx + 1 <= currentStepIndex;

          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center shrink-0 min-w-[56px] sm:min-w-[68px]">
                {/* Step Circle Indicator */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    showCheck
                      ? 'bg-[#1E2A78] text-white shadow-xs'
                      : showRing
                      ? 'border-[3px] border-[#1E2A78] bg-white text-transparent shadow-xs'
                      : 'border-2 border-[#D5D9E4] bg-white text-transparent'
                  }`}
                  data-step={step.id}
                  data-state={showCheck ? 'complete' : 'pending'}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {showCheck ? (
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-transparent" />
                  )}
                </div>

                {/* Step Label */}
                <span
                  className={`mt-1.5 text-[11px] sm:text-xs text-center whitespace-nowrap transition-colors ${
                    isCurrent
                      ? 'font-bold text-[#1E2A78]'
                      : isPriorCompleted
                      ? 'font-medium text-[#1B2033]'
                      : 'font-normal text-[#5A6178]'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line between steps */}
              {hasNext && (
                <div className="flex-1 mt-[13px] mx-1 sm:mx-2 h-[2px]">
                  <div
                    className={`h-full w-full transition-colors duration-200 ${
                      isNextCompleted ? 'bg-[#1E2A78]' : 'bg-[#D5D9E4]'
                    }`}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

