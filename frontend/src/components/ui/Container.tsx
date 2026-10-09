import type { ReactNode } from 'react';

interface ContainerProps {
  children: ReactNode;
  headerTitle?: string;
  className?: string;
}

export const ContainerHeader: React.FC<{ title: string }> = ({ title }) => {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1.5 h-4 bg-gradient-to-b from-blue-400 to-primary rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
      <h2 className="font-bold text-xs md:text-sm tracking-widest text-slate-700 dark:text-slate-300 uppercase">
        {title}
      </h2>
    </div>
  );
};

export const Container: React.FC<ContainerProps> = ({
  headerTitle,
  className,
  children,
}) => {
  return (
    <div
      className={`relative overflow-hidden bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/60 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-black/50 rounded-2xl p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:dark:border-white/20 ${className ?? ''}`}
    >
      {headerTitle && <ContainerHeader title={headerTitle} />}
      {children}
      {/* Subtle inner top highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 dark:via-white/10 to-transparent pointer-events-none !mt-0"></div>
    </div>
  );
};

export default Container;
