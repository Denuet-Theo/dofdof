/**
 * Une durée d'enclos, en jours au-delà de 48 h.
 *
 * Les cycles se comptent en heures, mais monter une monture au niveau 200 en
 * demande des centaines et un plan de haute génération des milliers : « 2 891h »
 * ne se lit pas, « 120 j » si.
 */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  if (hours >= 48) return `${Math.round(hours / 24)} j`;
  const whole = Math.floor(hours);
  return `${whole}h${String(Math.round((hours - whole) * 60)).padStart(2, '0')}`;
}

export function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return 'Jamais';

  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "À l'instant";
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `Il y a ${diffInMinutes} min`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `Il y a ${diffInHours} h`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `Il y a ${diffInDays} j`;
  
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `Il y a ${diffInMonths} mois`;
  
  const diffInYears = Math.floor(diffInMonths / 12);
  return `Il y a ${diffInYears} an${diffInYears > 1 ? 's' : ''}`;
}

/**
 * Le fuseau dans lequel l'app affiche les dates, quel que soit l'hôte.
 *
 * Sans lui, `toLocaleString` prend le fuseau du **runtime** : UTC sur le serveur
 * de déploiement, Europe/Paris dans le navigateur. Les deux rendus divergent
 * alors de deux heures en été, et React refuse l'hydratation avec l'erreur #418
 * — « le texte rendu par le serveur ne correspond pas au client ». Ce n'est pas
 * un cas limite de minuit : l'écart existe à toute heure, donc l'erreur était
 * permanente sur chaque page.
 *
 * Le fuseau est figé plutôt que déduit du navigateur, parce qu'une valeur
 * déduite du navigateur est exactement ce que le serveur ne peut pas connaître
 * au moment où il rend le HTML.
 */
export const APP_TIME_ZONE = 'Europe/Paris';

/**
 * Un horodatage affichable, identique des deux côtés de l'hydratation.
 *
 * `undefined` pour une entrée absente ou illisible : mieux vaut ne rien afficher
 * qu'un « Invalid Date », qui ne dit rien de plus et occupe la place.
 */
export const formatStamp = (value: string | number | Date | undefined | null) => {
  if (value === undefined || value === null) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  return date.toLocaleString('fr-FR', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
