'use client';

import { AlertTriangle, X } from 'lucide-react';
import {
  clearWriteFailures,
  dismissWriteFailure,
  useWriteFailures,
} from '@/lib/errors/write-failures';

/**
 * Les écritures perdues, affichées par-dessus tout le reste jusqu'à ce qu'on les
 * ferme.
 *
 * Posée dans la mise en page protégée, donc présente sur les six écrans : une
 * écriture peut échouer depuis n'importe lequel, et celui qui échoue le plus
 * cher — la saisie de naissance — est aussi celui où l'on regarde le jeu à côté
 * plutôt que l'écran.
 *
 * ## Pourquoi en bas à droite, et pourquoi rouge
 *
 * En bas à droite parce que le haut de chaque page porte déjà ses propres titres
 * et que la fenêtre modale de saisie occupe le centre : une bannière en haut se
 * serait fait recouvrir par la modale au moment précis où elle a le plus à dire.
 * Rouge parce que l'ambre de cette app veut dire « à vérifier » — une génération
 * qui ne colle pas, une monture à acheter — et qu'une écriture perdue n'est pas
 * à vérifier, elle est à refaire.
 *
 * ## Pourquoi rien ne s'efface tout seul
 *
 * `z-index` haut, pas de minuterie, pas de repli automatique. Voir l'en-tête de
 * `write-failures.ts` : c'est le point entier du module. Une alerte qui expire
 * ramène le silence qu'on cherche à supprimer, avec en plus la certitude qu'elle
 * a été affichée — donc qu'on l'a « prévenu ».
 */
const WriteFailureAlerts = () => {
  const failures = useWriteFailures();
  if (failures.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] w-[min(28rem,calc(100vw-2rem))] space-y-2"
      role="alert"
      aria-live="assertive"
    >
      {failures.length > 1 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={clearWriteFailures}
            className="text-[10px] text-dark-400 hover:text-dark-200 transition-colors
              cursor-pointer px-2 py-1 rounded-lg bg-dark-900/90 border border-dark-700/60"
          >
            tout fermer ({failures.length})
          </button>
        </div>
      )}

      {failures.map((failure) => (
        <div
          key={failure.id}
          className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-loss/15 border
            border-loss/40 backdrop-blur-sm shadow-lg"
        >
          <AlertTriangle size={14} className="text-loss mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-semibold text-loss-light">
              Pas enregistré — {failure.what}
            </p>
            {/* Le message de la base tel quel, y compris s'il est long : c'est lui
                qui dit s'il faut se reconnecter, corriger une saisie ou appeler
                à l'aide. Le tronquer rendrait la bannière décorative. */}
            <p className="text-[11px] text-dark-200 break-words">{failure.message}</p>
            <p className="text-[10px] text-dark-500">
              À refaire : ce geste n&apos;est pas dans la base.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismissWriteFailure(failure.id)}
            title="Fermer"
            className="text-dark-500 hover:text-dark-200 transition-colors cursor-pointer shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default WriteFailureAlerts;
