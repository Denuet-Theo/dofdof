-- Pouvoir refuser le crédit des bébés hors cible.
--
-- Un accouplement produit toujours un bébé : les 30 à 90 % portent sur sa
-- génération, pas sur son existence. Une tentative « ratée » rend donc une
-- monture d'une autre couleur, et `lineageValue` la valorise à ce qu'elle aurait
-- coûté à se procurer. C'est exact, et le modèle d'ascendance mesuré en #49 le
-- chiffre désormais au centième.
--
-- Mais c'est exact pour **valoriser**, pas pour **planifier**. Un raté rend une
-- couleur tirée dans l'ascendance, pas celle dont le plan a besoin : sur une
-- route vers la génération 10, on accumule des couleurs de génération 2 dont on
-- ne fera rien. Le crédit est donc une borne optimiste.
--
-- L'écart entre les deux régimes n'est pas cosmétique. Sur la route de référence
-- du tableur, avec clonage et niveaux optimisés, une génération 10 revient à
-- 472 000 kamas sans crédit et ressort à gain net avec. Et laissé libre,
-- l'optimiseur descend le niveau des parents pour rater exprès et encaisser des
-- ancêtres — il exploite le modèle plutôt que le jeu.
--
-- D'où un réglage plutôt qu'une constante : les deux lectures sont défendables,
-- et c'est à l'éleveur de dire laquelle il veut voir.
--
-- Défaut à `true`, qui est le comportement d'avant : changer la valeur par
-- défaut déplacerait en silence tous les chiffres déjà lus.

alter table public.user_breeding_settings
  add column if not exists credit_off_target boolean not null default true;

comment on column public.user_breeding_settings.credit_off_target is
  'Valoriser les bébés hors cible à ce qu''ils auraient coûté. À false, un croisement raté ne rapporte rien : borne prudente, qui évite que l''optimiseur choisisse de rater.';
