'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardList } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { pickByNames } from '@/lib/dofus/breeding/pick';
import type { Individual } from '@/lib/dofus/breeding/stable';

/**
 * Désigner un lot en **collant** la liste du jeu, au lieu de cocher.
 *
 * ## Pourquoi cet écran existe
 *
 * La correction en lot sait passer cinquante montures fécondes d'un coup. Il
 * fallait encore les désigner, et cinquante cases à cocher dans une liste de
 * deux cents, avec des homonymes à départager à l'œil, est la tâche où l'on se
 * trompe — et on ne s'en aperçoit qu'après, quand la politique planifie sur une
 * écurie fausse. « Trop fastidieux et source d'erreur », et c'est exact.
 *
 * Or la désignation existe déjà : c'est la liste de l'écran d'enclos du jeu.
 * Chaque monture y porte le nom que l'outil lui a dicté. On la copie, on la
 * colle, le lot est désigné. Même geste que `BreedingImportMounts`, qui relit
 * une écurie entière depuis ces noms plutôt que de la ressaisir.
 *
 * ## Ce que la fenêtre montre avant d'agir
 *
 * Le compte de ce qui sera coché, et surtout **ce qui manque** : une ligne qui
 * ne désigne rien est une monture qui restera fausse, et elle doit se voir avant
 * qu'on referme. C'est le même parti pris que la sortie d'enclos — dire avant le
 * clic ce qu'on ne pourra pas faire.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** L'écurie entière : on désigne aussi ce que le filtre courant cache. */
  individuals: readonly Individual[];
  /** Coche exactement ces montures, en remplaçant la sélection en cours. */
  onPick: (ids: string[]) => void;
};

const BreedingPickByName = ({ isOpen, onClose, individuals, onPick }: Props) => {
  const [pasted, setPasted] = useState('');

  /** Ce que la liste collée désigne, recalculé à la frappe. */
  const result = useMemo(() => pickByNames(pasted, individuals), [pasted, individuals]);
  const missing = result.misses.reduce((total, miss) => total + (miss.wanted - miss.found), 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Coller une liste de noms" size="lg">
      <div className="space-y-3">
        <p className="text-[11px] text-dark-500">
          Copie la liste d&apos;un enclos — ou de l&apos;écurie — depuis le jeu, et colle-la ici :
          une monture par ligne. Seul le <strong className="text-dark-300">nom</strong> est lu,{' '}
          <code className="text-kamas">G3 AM M EBOR-INPO</code> ; la génération, le niveau et le
          reste du décor sont écartés. Ajoute <code className="text-kamas">×2</code> en fin de ligne
          si tu en veux deux du même nom.
        </p>
        <p className="text-[11px] text-dark-500">
          Quand plusieurs montures portent le même nom — c&apos;est fréquent, le nom dit la couleur
          et l&apos;ascendance, pas l&apos;individu — la sélection prend les{' '}
          <strong className="text-dark-300">fertiles non fécondes</strong>, du niveau le plus bas
          d&apos;abord. C&apos;est ce qui sort d&apos;un enclos.
        </p>

        <textarea
          value={pasted}
          data-testid="pick-input"
          onChange={(event) => setPasted(event.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={'G1 DO F DO-DO\nG1 EB F EB-EB ×2\nG2 DOPO M DOIN-PO'}
          className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-100 text-[12px] font-mono transition-all hover:border-dark-500
            focus:border-kamas/50 custom-scrollbar"
        />

        {result.wanted > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span data-testid="pick-count" data-count={result.ids.length} className="text-dark-300">
              <strong className="text-kamas tabular-nums">{result.ids.length}</strong> monture
              {result.ids.length > 1 ? 's' : ''} désignée{result.ids.length > 1 ? 's' : ''}
              {' '}sur {result.wanted} demandée{result.wanted > 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Ce qui manque, nommé. Une ligne qui ne désigne rien est une monture
            qui restera fausse : la compter sans la nommer ne servirait qu'à
            inquiéter. */}
        {result.misses.length > 0 && (
          <div
            data-testid="pick-missing"
            data-count={missing}
            className="px-3 py-2 rounded-xl bg-loss/10 border border-loss/30 space-y-1"
          >
            <p className="flex items-center gap-1.5 text-[11px] text-dark-300">
              <AlertTriangle size={13} className="text-loss-light shrink-0" />
              <span>
                <strong className="text-loss-light">{missing}</strong> monture
                {missing > 1 ? 's' : ''}{' '}que l&apos;écurie ne peut pas fournir — vérifie le nom,
                ou ajoute-la avec « Ajouter une monture ».
              </span>
            </p>
            <div className="max-h-28 overflow-y-auto custom-scrollbar space-y-0.5">
              {result.misses.map((miss) => (
                <p key={miss.name} className="text-[10px] text-dark-400 font-mono">
                  {miss.name}
                  <span className="text-dark-600">
                    {' '}
                    —{' '}
                    {miss.found === 0
                      ? 'introuvable'
                      : `${miss.found} sur ${miss.wanted} seulement`}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            data-testid="pick-apply"
            disabled={result.ids.length === 0}
            onClick={() => {
              onPick(result.ids);
              setPasted('');
              onClose();
            }}
          >
            <Check size={13} />
            Cocher {result.ids.length} monture{result.ids.length > 1 ? 's' : ''}
          </Button>
          <span className="flex items-center gap-1.5 text-[10px] text-dark-600">
            <ClipboardList size={12} />
            remplace la sélection en cours
          </span>
        </div>
      </div>
    </Modal>
  );
};

export default BreedingPickByName;
