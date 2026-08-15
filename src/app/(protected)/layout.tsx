import Sidebar from '@/components/layout/Sidebar';
import WriteFailureAlerts from '@/components/ui/WriteFailureAlerts';

const ProtectedLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-dark-950">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <div className="p-8">{children}</div>
      </main>
      {/* Ici et pas dans chaque page : une écriture peut échouer depuis
          n'importe quel écran, et la placer six fois ferait qu'on l'oublierait
          au septième. */}
      <WriteFailureAlerts />
    </div>
  );
};

export default ProtectedLayout;
