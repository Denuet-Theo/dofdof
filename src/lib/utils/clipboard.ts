/**
 * Écrire dans le presse-papier, et **dire si ça a marché**.
 *
 * Trois endroits copient un nom : le bouton de `CopyableText`, l'icône de
 * `CopyableIcon`, et depuis la saisie de naissance le clic sur le poulain
 * lui-même. Les deux premiers avaient chacun leur `try / catch` refermé sur un
 * `console.error` — la forme exacte que `write-failures.ts` a été écrit pour
 * chasser côté base : un geste qui échoue sans le dire.
 *
 * Ici, l'enjeu est plus petit qu'une écriture perdue mais de même nature. Le
 * nom d'un poulain se colle **dans le jeu** ; si la copie échoue en silence, le
 * `Ctrl+V` suivant pose le contenu précédent du presse-papier — c'est-à-dire,
 * le plus souvent, le nom du poulain d'avant. Une monture mal nommée est une
 * monture qu'on ne retrouve plus dans une écurie où tout s'appelle « Anonyme ».
 *
 * D'où le booléen : l'appelant est obligé de regarder. Ce module ne montre rien
 * de lui-même — c'est l'écran qui sait quoi dire, et où.
 */
export const copyToClipboard = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    // Le journal reste, pour la cause exacte — permission refusée, contexte non
    // sécurisé, document sans focus. Il ne tient pas lieu d'avertissement.
    console.error('Clipboard copy failed:', error);
    return false;
  }
};
