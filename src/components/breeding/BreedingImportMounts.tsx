'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Upload } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { carriedGeneration, colorCoder, parseMountName } from '@/lib/dofus/breeding/naming';
import { MOUNT_STATUS_LABEL, type MountStatus, type Sex } from '@/lib/dofus/breeding/stable';
import type { AddResult } from '@/lib/hooks/useBreeding';

/**
 * Recharger une écurie entière depuis la liste de noms du jeu.
 *
 * L'assistant saisit **une** monture, et c'est le bon geste pour une naissance.
 * Ce n'en est pas un pour cent trente : à ce volume, la question n'est plus
 * « quelle couleur, quel sexe, quels parents » — elle est déjà répondue, et
 * elle l'est **dans le jeu**. Chaque monture y porte le nom que l'outil lui a
 * dicté, et ce nom encode exactement ce que la base enregistre : la couleur, le
 * sexe et les deux parents.
 *
 * Il suffit donc de relire. On copie la liste de l'écurie du jeu, on la colle
 * ici, une ligne par monture, et `parseMountName` fait le chemin inverse de
 * `mountName`.
 *
 * ## Ce que le nom ne porte pas
 *
 * Le **niveau** et l'**état**. Ils sont donc demandés une fois pour tout le lot,
 * avec une surcharge par ligne pour les exceptions — `G3 AM M DO-DO 120 féconde`.
 * Un lot est presque toujours homogène : on recharge un parc entier de fécondes,
 * ou une portée qui vient de naître au niveau 1.
 *
 * ## Pourquoi une prévisualisation, et pas un simple bouton
 *
 * Une ligne mal recopiée ne doit pas passer en silence. Chacune est donc relue
 * et affichée avec sa couleur, son sexe et ses parents **avant** d'écrire quoi
 * que ce soit : ce qui ne se lit pas est signalé à sa ligne, et le reste
 * s'importe quand même. Refuser tout le lot pour une faute de frappe ferait
 * recommencer cent trente lignes.
 *
 * La génération inscrite dans le nom est **redondante** — elle se déduit de la
 * couleur et des parents. C'est justement pour ça qu'elle est vérifiée : c'est
 * le seul contrôle disponible sur une ligne écrite à la main.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  colors: BreedingColor[];
  onAdd: (mount: {
    colorId: string;
    sex: Sex;
    level: number;
    status: MountStatus;
    parents: [string, string] | null;
  }) => Promise<AddResult>;
};

/** Une ligne relue : soit une monture prête à écrire, soit ce qui cloche. */
type Row =
  | {
      ok: true;
      line: number;
      raw: string;
      colorId: string;
      sex: Sex;
      parents: [string, string];
      level: number;
      status: MountStatus;
      /** Signalé sans bloquer : la génération écrite ne colle pas au calcul. */
      warning: string | null;
    }
  | { ok: false; line: number; raw: string; problem: string };

const STATUS_WORDS: { words: string[]; status: MountStatus }[] = [
  { words: ['fertile'], status: 'fertile' },
  { words: ['feconde', 'féconde'], status: 'feconde' },
  { words: ['sterile', 'stérile'], status: 'sterile' },
];

const BreedingImportMounts = ({ isOpen, onClose, colors, onAdd }: Props) => {
  const [text, setText] = useState('');
  const [level, setLevel] = useState(1);
  const [status, setStatus] = useState<MountStatus>('feconde');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ added: number; failures: string[] } | null>(null);

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  const code = useMemo(() => colorCoder(colors), [colors]);

  /**
   * La table qui traduit un code en couleur.
   *
   * Un code ambigu est **retiré** plutôt qu'arbitré : deux couleurs sous le même
   * code rendraient l'import silencieusement faux, et la ligne concernée mérite
   * d'être signalée. Sur les trois familles `colorCoder` n'en produit aucun,
   * mais ça ne se vérifie qu'ici.
   */
  const colorByCode = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const color of colors) {
      const key = code(color.name);
      seen.set(key, seen.has(key) ? null : color.id);
    }
    return seen;
  }, [colors, code]);

  const nameOf = (colorId: string) => byId.get(colorId)?.name ?? colorId;
  const generationOf = useCallback(
    (colorId: string) => byId.get(colorId)?.generation ?? 1,
    [byId]
  );
  const iconOf = (colorId: string) => {
    const color = byId.get(colorId);
    return color ? colorIconUrl(color) : null;
  };

  const rows = useMemo<Row[]>(() => {
    return text
      .split('\n')
      .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
      .filter(({ raw }) => raw.length > 0)
      .map(({ raw, line }): Row => {
        // Le niveau et l'état peuvent suivre le nom, dans n'importe quel ordre :
        // on les retire avant de relire ce qui reste comme un nom.
        let rest = raw;
        let lineLevel = level;
        let lineStatus = status;

        for (const { words, status: value } of STATUS_WORDS) {
          for (const word of words) {
            const found = new RegExp(`\\s${word}\\b`, 'i');
            if (found.test(rest)) {
              lineStatus = value;
              rest = rest.replace(found, '');
            }
          }
        }

        const levelMatch = rest.match(/\s(\d{1,3})\s*$/);
        if (levelMatch) {
          const value = Number(levelMatch[1]);
          if (value >= 1 && value <= 200) {
            lineLevel = value;
            rest = rest.slice(0, levelMatch.index);
          }
        }

        const parsed = parseMountName(rest);
        if (!parsed) {
          return {
            ok: false,
            line,
            raw,
            problem: 'Pas un nom dicté par l’outil — attendu « G3 AM M DO-DO ».',
          };
        }

        const colorId = colorByCode.get(parsed.colorCode);
        if (colorId === undefined) {
          return { ok: false, line, raw, problem: `Code de couleur inconnu : ${parsed.colorCode}.` };
        }
        if (colorId === null) {
          return { ok: false, line, raw, problem: `Code ambigu : ${parsed.colorCode}.` };
        }

        const parentIds = parsed.parentCodes.map((parentCode) => colorByCode.get(parentCode));
        const unknown = parsed.parentCodes.filter((_, index) => !parentIds[index]);
        if (unknown.length > 0) {
          return { ok: false, line, raw, problem: `Parent inconnu : ${unknown.join(', ')}.` };
        }

        const parents = parentIds as [string, string];
        const expected = carriedGeneration(generationOf(colorId), [
          generationOf(parents[0]),
          generationOf(parents[1]),
        ]);

        return {
          ok: true,
          line,
          raw,
          colorId,
          sex: parsed.sex,
          parents,
          level: lineLevel,
          status: lineStatus,
          warning:
            expected === parsed.carriedGeneration
              ? null
              : `Le nom annonce G${parsed.carriedGeneration}, la généalogie donne G${expected}.`,
        };
      });
  }, [text, level, status, colorByCode, generationOf]);

  const valid = rows.filter((row): row is Extract<Row, { ok: true }> => row.ok);
  const broken = rows.filter((row): row is Extract<Row, { ok: false }> => !row.ok);

  const run = async () => {
    setRunning(true);
    setDone(null);
    let added = 0;
    const failures: string[] = [];

    // En série et non en parallèle : cinquante insertions simultanées sur une
    // base partagée n'iront pas plus vite qu'elles, et une erreur au milieu doit
    // pouvoir être rapportée à **sa** ligne.
    for (const row of valid) {
      const result = await onAdd({
        colorId: row.colorId,
        sex: row.sex,
        level: row.level,
        status: row.status,
        parents: row.parents,
      });
      if (result.ok) added += 1;
      else failures.push(`ligne ${row.line} — ${result.message}`);
    }

    setRunning(false);
    setDone({ added, failures });
    // Ce qui est passé est retiré du texte : relancer après avoir corrigé les
    // lignes fautives ne doit pas re-créer ce qui existe déjà.
    if (failures.length === 0) setText('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Importer une écurie" size="xl">
      <div className="space-y-4">
        <p className="text-[11px] text-dark-500">
          Une ligne par monture, avec le nom qu&apos;elle porte <strong>dans le jeu</strong> — il
          encode déjà sa couleur, son sexe et ses deux parents. Copie la liste depuis l&apos;écurie
          du jeu et colle-la ici. Le niveau et l&apos;état ne sont pas dans le nom : ils se règlent
          une fois pour tout le lot, et se surchargent ligne par ligne
          {' — '}
          <code className="text-dark-400">G3 AM M DO-DO 120 féconde</code>.
        </p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-dark-400 mb-1 block">Niveau du lot</label>
            <input
              type="number"
              min={1}
              max={200}
              value={String(level)}
              onChange={(event) =>
                setLevel(Math.max(1, Math.min(200, Number(event.target.value) || 1)))
              }
              className="w-24 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm text-right transition-all hover:border-dark-500
                focus:border-kamas/50"
            />
          </div>
          <div>
            <span className="text-xs text-dark-400 mb-1 block">État du lot</span>
            <div className="flex flex-wrap gap-2">
              {(['fertile', 'feconde', 'sterile'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatus(value)}
                  className={`px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                    status === value
                      ? 'bg-kamas/15 border-kamas/40 text-kamas'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
                >
                  {MOUNT_STATUS_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'G3 AM M DO-DO\nG3 AM F DO-DO\nG4 RO M AM-DO 120'}
          className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-100 text-xs font-mono placeholder:text-dark-600 transition-all
            hover:border-dark-500 focus:border-kamas/50"
        />

        {rows.length > 0 && (
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
            {rows.map((row) =>
              row.ok ? (
                <div
                  key={row.line}
                  className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-dark-800/40"
                >
                  <span className="text-[10px] text-dark-600 w-6 tabular-nums">{row.line}</span>
                  <ColorChip
                    name={nameOf(row.colorId)}
                    code={code(nameOf(row.colorId))}
                    icon={iconOf(row.colorId)}
                    size="sm"
                  />
                  <span className="text-xs text-dark-200">{nameOf(row.colorId)}</span>
                  <GenBadge generation={generationOf(row.colorId)} />
                  <span className={row.sex === 'M' ? 'text-info' : 'text-loss-light'}>
                    {row.sex === 'M' ? '♂' : '♀'}
                  </span>
                  <span className="text-[10px] text-dark-500">niv. {row.level}</span>
                  <span className="text-[10px] text-dark-500">
                    {MOUNT_STATUS_LABEL[row.status]}
                  </span>
                  <span className="text-[10px] text-dark-600 truncate">
                    ← {row.parents.map(nameOf).join(' × ')}
                  </span>
                  {row.warning && (
                    <span className="text-[10px] text-amber-400/80" title={row.warning}>
                      ⚠ génération
                    </span>
                  )}
                </div>
              ) : (
                <div
                  key={row.line}
                  className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-loss/10"
                >
                  <span className="text-[10px] text-dark-600 w-6 tabular-nums">{row.line}</span>
                  <code className="text-[11px] text-dark-300">{row.raw}</code>
                  <span className="text-[10px] text-loss">{row.problem}</span>
                </div>
              )
            )}
          </div>
        )}

        {done && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] text-profit">
              <Check size={12} /> {done.added} monture{done.added > 1 ? 's' : ''} enregistrée
              {done.added > 1 ? 's' : ''}.
            </p>
            {done.failures.map((failure) => (
              <p key={failure} className="flex items-start gap-1.5 text-[11px] text-loss">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {failure}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={running || valid.length === 0} onClick={run}>
            <Upload size={13} />
            {running
              ? 'Import en cours…'
              : `Importer ${valid.length} monture${valid.length > 1 ? 's' : ''}`}
          </Button>
          {broken.length > 0 && (
            <span className="text-[11px] text-amber-400/80">
              {broken.length} ligne{broken.length > 1 ? 's' : ''} illisible
              {broken.length > 1 ? 's' : ''} — elle{broken.length > 1 ? 's' : ''} ser
              {broken.length > 1 ? 'ont' : 'a'} ignorée{broken.length > 1 ? 's' : ''}, le reste
              passe.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default BreedingImportMounts;
