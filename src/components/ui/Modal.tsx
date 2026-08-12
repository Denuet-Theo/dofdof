'use client';

import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * Modals stack — the recipe popin opens the price modal on top of itself — so the
 * body-scroll lock belongs to the stack rather than to each instance, and Escape only
 * reaches the top layer. Per-instance ownership would let the inner modal hand
 * scrolling back to a page that is still covered, and make one Escape close the pile.
 *
 * ## Ce que l'accessibilité couvre ici
 *
 * Le panneau se déclare (`role="dialog"`, `aria-modal`), porte son nom
 * (`aria-labelledby` sur le titre) et sa croix a un intitulé.
 *
 * ## Le focus est piégé, et la pile est ce qui rend ça délicat
 *
 * `aria-modal="true"` promet que le reste de la page est hors-jeu. Sans piège de
 * focus la promesse est fausse : la tabulation sortait du panneau vers une page
 * qu'une aide technique annonce comme inerte, et on s'y perdait sans rien voir
 * bouger à l'écran.
 *
 * Trois choses, et la troisième est celle que la pile complique :
 *
 * 1. **à l'ouverture**, le focus entre dans le panneau — son premier élément
 *    focalisable, ou le panneau lui-même s'il n'en contient aucun ;
 * 2. **pendant**, Tab et Shift+Tab bouclent à l'intérieur. Seul le panneau du
 *    **sommet** de la pile écoute, par le même test de profondeur qu'Escape :
 *    sans lui, la popin de recette et celle de prix se disputeraient chaque
 *    tabulation et le piège de l'une renverrait dans l'autre ;
 * 3. **à la fermeture**, le focus retourne exactement là où il était. Quand
 *    l'étage fermé est un étage intérieur, « là où il était » est un élément de
 *    l'étage extérieur, toujours ouvert — c'est ce qui fait que refermer la modale
 *    de prix rend la main à la ligne d'ingrédient qu'on venait de cliquer, et non
 *    au haut de la page.
 *
 * L'élément mémorisé peut avoir disparu entre-temps — une ligne que la saisie a
 * fait disparaître, par exemple — d'où la vérification qu'il est encore dans le
 * document avant de lui rendre le focus.
 */
let openModals = 0;

/**
 * Ce qui peut recevoir le focus dans un panneau.
 *
 * `:not([disabled])` et `tabindex="-1"` écartés : un bouton désactivé et un
 * élément retiré du parcours ne doivent pas piéger la tabulation sur eux.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const Modal = ({ isOpen, onClose, title, children, size = 'md' }: ModalProps) => {
  const depth = useRef(0);
  // Le panneau, pour y contenir la tabulation.
  const panel = useRef<HTMLDivElement>(null);
  // Relie le panneau à son titre. `useId` est stable entre serveur et client,
  // ce qu'un compteur ou un tirage ne serait pas.
  const titleId = useId();

  // Read through a ref so the effect below depends on `isOpen` alone. Callers pass an
  // inline arrow, and re-running on every render would reshuffle the stack depths.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    openModals += 1;
    depth.current = openModals;
    document.body.style.overflow = 'hidden';

    // Où rendre le focus en partant. Lu avant de le déplacer, sinon on
    // mémoriserait le panneau lui-même.
    const restoreTo = document.activeElement as HTMLElement | null;

    // Copié dans l'effet : au moment du nettoyage, React a pu remettre le ref à
    // null, et le comparer là-bas ne filtrerait alors plus notre propre panneau.
    const own = panel.current;

    // Entrer dans le panneau. Le premier focalisable, sinon le panneau — qui
    // porte `tabIndex={-1}` pour pouvoir le recevoir sans entrer dans le
    // parcours de tabulation.
    const focusables = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
    (focusables()[0] ?? panel.current)?.focus();

    const handleKey = (e: KeyboardEvent) => {
      // Seul le sommet de la pile écoute : voir la note de tête.
      if (depth.current !== openModals) return;

      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const inside = focusables();
      if (inside.length === 0) {
        // Rien à parcourir : on garde le focus sur le panneau plutôt que de
        // laisser la tabulation partir derrière.
        e.preventDefault();
        panel.current?.focus();
        return;
      }

      const first = inside[0];
      const last = inside[inside.length - 1];
      const active = document.activeElement;

      // Le bouclage, et le cas où le focus a échappé au panneau — un clic dans la
      // page derrière, par exemple : Tab le ramène dedans au lieu de continuer.
      if (!panel.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('keydown', handleKey);
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = 'unset';

      // Rendre le focus. Deux cas, et le second n'est pas un cas limite : c'est
      // celui de la pile.
      //
      // L'élément mémorisé peut avoir disparu — une ligne que la saisie a fait
      // disparaître — mais surtout il peut n'avoir jamais existé. La modale
      // intérieure s'ouvre en cliquant une **ligne**, qui est un `div` et ne prend
      // donc pas le focus : `document.activeElement` valait `body` à ce moment-là,
      // et le lui rendre revient à ne le rendre à personne.
      //
      // On se replie alors sur le panneau de l'étage encore ouvert — ce qui est le
      // comportement attendu de toute façon : refermer la modale de prix doit
      // ramener dans la recette, pas derrière elle.
      const usable = restoreTo && restoreTo !== document.body && document.contains(restoreTo);
      if (usable) {
        restoreTo.focus();
        return;
      }
      if (openModals > 0) {
        const below = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
          .filter((element) => element !== own)
          .pop();
        below?.focus();
      }
    };
  }, [isOpen]);

  // No modal is ever open on the first render, so the server and the client agree on
  // `null` here and the portal only ever runs in the browser.
  if (!isOpen || typeof document === 'undefined') return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    // Deux fiches de monture côte à côte et une colonne centrale : en dessous de
    // cette largeur, la fenêtre d'accouplement se replie en trois lignes et
    // cesse de ressembler à ce qu'elle reproduit.
    xl: 'max-w-4xl',
  };

  // Every card shell in the app is `.glass`, and a backdrop-filter makes an element the
  // containing block of its fixed-position descendants. A modal rendered inside a card
  // would size itself to that card, so it always goes through a portal to the body —
  // which also stacks it above any modal already open, portals appending in mount order.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop. `aria-hidden` : c'est un raccourci à la souris qui double la
          croix et Escape, donc il n'a rien à annoncer — et sans nom accessible il
          serait annoncé comme un élément vide. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={panel}
        // `tabIndex={-1}` : le panneau doit pouvoir recevoir le focus quand il ne
        // contient rien de focalisable, sans pour autant entrer dans le parcours.
        tabIndex={-1}
        // `role="dialog"` manquait : sans lui le panneau n'est qu'une pile de
        // `div` pour une aide technique, et rien ne dit que le reste de la page
        // est momentanément hors-jeu. `aria-labelledby` lui donne son nom, et le
        // titre était déjà là — il n'était relié à rien.
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`
          relative w-full ${sizes[size]}
          glass-strong rounded-2xl p-6
          animate-slide-up
          shadow-2xl shadow-dark-950/50
          max-h-[90vh] overflow-y-auto custom-scrollbar
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 id={titleId} className="text-lg font-bold text-dark-100">
            {title}
          </h2>
          {/* Une croix seule n'a pas de nom accessible : l'icône est décorative
              et le bouton était annoncé sans intitulé. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg text-dark-500 hover:text-dark-200 hover:bg-dark-700/50 transition-colors cursor-pointer"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        {children}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
