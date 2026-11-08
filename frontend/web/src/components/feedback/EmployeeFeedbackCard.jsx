import React from 'react';
import StarRating from './StarRating';

const MAX_COMMENT_LENGTH = 500;

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
];

function getAvatarColor(id) {
  if (typeof id === 'number' && !isNaN(id)) {
    return AVATAR_COLORS[Math.abs(id - 1) % AVATAR_COLORS.length];
  }
  const str = String(id || '1');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash + str.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash];
}

function getInitials(name) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function EmployeeFeedbackCard({
  employee,
  rating,
  onRatingChange,
  comment,
  onCommentChange,
  readOnly = false,
  submissionDate,
}) {
  if (readOnly) {
    return (
      <div className="rounded-2xl border border-gray-150 bg-white p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow-xs ${getAvatarColor(employee.id)}`}>
            {getInitials(employee.name)}
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{employee.name}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">{employee.jobTitle}</p>
          </div>
        </div>
        <div className="mt-3.5">
          <StarRating value={rating} readOnly size="lg" />
        </div>
        {comment && (
          <p className="mt-3 text-sm leading-relaxed text-gray-700 bg-gray-50/80 rounded-xl p-3.5 border border-gray-100">{comment}</p>
        )}
        {submissionDate && (
          <p className="mt-2.5 text-xs text-gray-400">Submitted on {submissionDate}</p>
        )}
      </div>
    );
  }

  const remaining = MAX_COMMENT_LENGTH - (comment?.length || 0);

  return (
    <div className="rounded-2xl border border-gray-150 bg-white p-5 sm:p-6 shadow-xs">
      <div className="flex items-center gap-3.5">
        <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow-xs ${getAvatarColor(employee.id)}`}>
          {getInitials(employee.name)}
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{employee.name}</p>
          <p className="text-xs text-gray-500 font-medium mt-0.5">{employee.jobTitle}</p>
        </div>
      </div>

      <div className="mt-3.5">
        <StarRating value={rating} onChange={onRatingChange} />
      </div>

      <div className="mt-3.5">
        <textarea
          value={comment || ''}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Tell us about this employee's support experience..."
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 p-3.5 text-sm text-gray-800 outline-none transition-colors focus:border-[#252578]/40 focus:bg-white focus:ring-2 focus:ring-[#252578]/15 placeholder:text-gray-400"
        />
        <div className="mt-1.5 flex justify-end">
          <span className={`text-xs ${remaining < 50 ? 'font-semibold text-red-500' : 'text-gray-400'}`}>
            {remaining}/{MAX_COMMENT_LENGTH}
          </span>
        </div>
      </div>
    </div>
  );
}
