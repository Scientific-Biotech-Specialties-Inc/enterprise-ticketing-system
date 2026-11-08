import React from 'react';
import { useAuth } from '@/context/AuthContext';
import SkeletonLoader from '@/components/SkeletonLoader.jsx';

export default function AuthGate({ children }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading || (isAuthenticated && !user)) {
    return (
      <div className="min-h-screen flex flex-col justify-start p-8 bg-page text-dark-slate space-y-6">
        <div className="flex justify-between items-center w-full mx-auto mb-4">
          <SkeletonLoader className="h-10 w-48" />
          <SkeletonLoader className="h-10 w-24 rounded-full" />
        </div>
        <div className="w-full mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
        </div>
        <div className="w-full mx-auto bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
          <div className="space-y-4">
            <SkeletonLoader className="h-8 w-1/3 mb-6" />
            <div className="space-y-3">
              <SkeletonLoader className="h-12 w-full rounded-xl" />
              <SkeletonLoader className="h-12 w-full rounded-xl" />
              <SkeletonLoader className="h-12 w-full rounded-xl" />
              <SkeletonLoader className="h-12 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
