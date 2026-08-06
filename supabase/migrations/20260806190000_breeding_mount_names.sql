-- L'écurie apprend le nom que porte chaque monture en jeu.
--
-- Le jeu laisse renommer une monture sur 20 caractères, « Anonyme » par défaut.
-- C'est le seul champ qui se lise depuis la liste de l'écurie, sans ouvrir une
-- fiche — donc le seul endroit où inscrire ce qui distingue une monture d'une
-- autre de même couleur.
--
-- Ce qui les distingue, c'est leur ascendance : depuis #59, une gen 2 née d'une
-- Amande gen 3 vise la gen 4, là où ses voisines de même couleur ne visent que
-- la gen 3. En jeu, rien ne les sépare — même couleur, même génération affichée,
-- toutes « Anonyme ». Le nom porte donc la généalogie : `G3 AMA-DOR`.
--
-- Voir `naming.ts` pour la forme et ce qu'elle économise. Ici, seule compte la
-- conséquence : ce nom est saisi **dans le jeu**, à la main, et l'outil doit
-- retenir ce qu'il a dicté pour reconnaître la monture au tour suivant.

alter table public.user_breeding_individuals
  add column if not exists name text;

comment on column public.user_breeding_individuals.name is
  'Nom porté par la monture dans le jeu, 20 caractères au plus. Dicté par l''outil sous la forme « G3 AMA-DOR » — génération la plus haute de la généalogie, puis les codes des deux parents — parce que c''est la seule chose qui se lise depuis la liste de l''écurie du jeu. NULL vaut « Anonyme », le défaut du jeu.';

-- Les montures déjà enregistrées gardent leur nom vide : on ne peut pas deviner
-- ce qui est écrit dans le jeu, et inventer un nom ferait chercher en écurie une
-- monture qui ne le porte pas. L'écran affiche le nom **suggéré** à côté du nom
-- retenu, ce qui laisse rattraper l'existant au rythme où on y passe.
