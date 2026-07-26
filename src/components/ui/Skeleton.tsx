interface SkeletonProps {
  className?: string;
  count?: number;
}

const Skeleton = ({ className = '', count = 1 }: SkeletonProps) => {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`rounded-xl animate-shimmer ${className}`}
        />
      ))}
    </>
  );
};

export default Skeleton;
