'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Modals stack — the recipe popin opens the price modal on top of itself — so the
 * body-scroll lock belongs to the stack rather than to each instance, and Escape only
 * reaches the top layer. Per-instance ownership would let the inner modal hand
 * scrolling back to a page that is still covered, and make one Escape close the pile.
 */
let openModals = 0;

const Modal = ({ isOpen, onClose, title, children, size = 'md' }: ModalProps) => {
  const depth = useRef(0);

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

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && depth.current === openModals) onCloseRef.current();
    };
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // No modal is ever open on the first render, so the server and the client agree on
  // `null` here and the portal only ever runs in the browser.
  if (!isOpen || typeof document === 'undefined') return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
  };

  // Every card shell in the app is `.glass`, and a backdrop-filter makes an element the
  // containing block of its fixed-position descendants. A modal rendered inside a card
  // would size itself to that card, so it always goes through a portal to the body —
  // which also stacks it above any modal already open, portals appending in mount order.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div
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
          <h2 className="text-lg font-bold text-dark-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-dark-500 hover:text-dark-200 hover:bg-dark-700/50 transition-colors cursor-pointer"
          >
            <X size={18} />
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
