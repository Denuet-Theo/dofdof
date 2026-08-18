/**
 * Une durée telle qu'on l'attend, du côté court.
 *
 * `formatHours` de `utils/date` ne convient pas : il bascule en jours au-delà de
 * 48 h et arrondit au quart d'heure près, ce qui est bon pour un plan de six
 * mois et illisible pour « dans 18 min ».
 *
 * ## Pourquoi un fichier pour une fonction
 *
 * Elle vivait dans `timeline.ts`, 833 lignes décrivant le ruban de la timeline —
 * les jauges, les pistes, les événements, le format d'un plan embarqué et son
 * `parsePlan`. De tout ça, l'écran n'appelait plus que cette fonction-là : le
 * ruban a été retiré de l'app, et `model-plans/` avec lui. Garder huit cents
 * lignes pour un formateur de durée aurait laissé croire que le format de plan
 * était encore lu quelque part.
 */
export const formatCountdown = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '—';

  const late = seconds < 0;
  const total = Math.round(Math.abs(seconds));

  if (total < 60) return late ? "à l'instant" : 'moins d’1 min';

  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const value =
    days >= 2
      ? `${days} j`
      : hours >= 1
        ? `${hours} h ${String(minutes % 60).padStart(2, '0')}`
        : `${minutes} min`;

  return late ? `il y a ${value}` : value;
};
