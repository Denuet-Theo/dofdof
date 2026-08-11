/**
 * Le rappel sonore : deux notes, une minute avant qu'une jauge change.
 *
 * ## Pourquoi une synthèse et pas un fichier
 *
 * Un `.mp3` ferait un aller-retour réseau au moment précis où on en a besoin, et
 * un onglet en arrière-plan n'a aucune raison de l'avoir gardé en cache. Deux
 * oscillateurs coûtent zéro octet, se déclenchent en une milliseconde et sonnent
 * pareil hors ligne.
 *
 * ## Le navigateur exige un geste
 *
 * Aucun son ne part avant que l'utilisateur ait cliqué quelque part : c'est une
 * règle des navigateurs, pas un réglage. L'interrupteur **est** ce geste, et il
 * réveille le contexte audio au passage — d'où `unlock`, qu'on appelle à
 * l'activation et non au premier rappel, sinon le premier serait muet.
 *
 * ## Deux notes plutôt qu'une
 *
 * Une note seule se confond avec une notification du système. Une quinte montante
 * s'identifie sans qu'on ait à lever les yeux, ce qui est tout l'objet — on met ce
 * rappel pour ne **pas** avoir à surveiller l'écran.
 */

/** La quinte : la, puis mi au-dessus. */
const NOTES = [880, 1318.5];
const NOTE_SECONDS = 0.16;

let context: AudioContext | null = null;

const audio = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
};

/**
 * Prépare le contexte audio, sur un geste de l'utilisateur.
 *
 * À appeler quand on **active** le rappel. Un contexte créé hors d'un geste naît
 * suspendu et reste muet jusqu'au suivant : le premier rappel passerait à la
 * trappe, et c'est précisément celui qu'on aurait voulu entendre.
 */
export const unlock = async (): Promise<boolean> => {
  const engine = audio();
  if (!engine) return false;
  if (engine.state === 'suspended') {
    try {
      await engine.resume();
    } catch {
      return false;
    }
  }
  return engine.state === 'running';
};

/** Sonne, si le contexte est prêt. Sans effet et sans erreur sinon. */
export const chime = (): void => {
  const engine = audio();
  if (!engine || engine.state !== 'running') return;

  NOTES.forEach((frequency, index) => {
    const at = engine.currentTime + index * NOTE_SECONDS;
    const oscillator = engine.createOscillator();
    const gain = engine.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    // Une enveloppe, pas un interrupteur : couper net une sinusoïde produit un
    // clic, qui s'entend plus que la note.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS);

    oscillator.connect(gain).connect(engine.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_SECONDS + 0.02);
  });
};
