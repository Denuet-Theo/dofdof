import type { Locator, Page } from '@playwright/test';

/**
 * Ce que tous les écrans partagent, et qui ne se range donc sous aucun d'eux.
 *
 * La bannière d'écriture perdue vit dans la mise en page protégée : elle peut
 * apparaître depuis n'importe quelle page, et c'est elle qu'on interroge pour
 * savoir si une écriture refusée a été **dite** plutôt que ravalée. Elle était
 * définie avec les gestes d'élevage, qui l'ont demandée la première ; le
 * compteur en a besoin pour exactement la même raison.
 */

/** La bannière de `WriteFailureAlerts`. */
export const failureBanner = (page: Page): Locator =>
  page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' });
