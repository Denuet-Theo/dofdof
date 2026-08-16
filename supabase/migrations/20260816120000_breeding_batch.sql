-- La fournée en cours : **ce qui est réellement dans les enclos**.
--
-- Jusqu'ici, personne ne l'écrivait nulle part. L'écran affichait la fournée que
-- la politique proposait, recalculée à chaque rendu à partir de l'écurie du
-- moment. Charger un enclos ne laissait aucune trace : ni quelles montures y
-- étaient entrées, ni quand.
--
-- La conséquence a été remontée par plusieurs joueurs, et elle est mécanique. On
-- charge cinq enclos le matin, on revient le soir pour les sortir — mais entre
-- les deux l'écurie a bougé (naissances saisies, montures achetées, clonages), la
-- politique repropose donc une **autre** fournée, et la fenêtre « Les sortir de
-- l'enclos » offre à sortir des montures qui n'y ont jamais été mises. L'éleveur
-- passait alors en fécondes un lot qui n'avait pas payé son cycle, pendant que
-- celles qui l'avaient payé restaient fertiles.
--
-- ## Pourquoi un instantané et non un recalcul
--
-- Un enclos est un objet du **jeu**, pas un résultat de calcul. Une fois refermé,
-- son contenu ne dépend plus de rien : ni des prix du jour, ni de l'écurie, ni de
-- ce que la politique penserait maintenant. Le seul enregistrement honnête est
-- donc une copie de ce qui y est entré, prise au moment où l'éleveur déclare
-- l'avoir rempli — c'est ce que fait le bouton « verrouiller ».
--
-- ## Pourquoi toute la fournée est figée au premier verrou
--
-- Verrouiller l'enclos 1 seul ne suffirait pas : les enclos 2 à 5, eux, seraient
-- toujours recalculés, et ils changeraient sous les doigts entre deux
-- chargements — le même défaut, décalé d'un enclos. `pens` porte donc la fournée
-- **entière** dès le premier verrou, verrouillés et à venir ensemble.
--
-- ## Pourquoi du JSON
--
-- Une monture d'enclos n'a pas toujours de ligne à elle. Le vrac est un compteur
-- par couleur (`user_breeding_mounts`), et ce que le plan va **procurer** n'existe
-- nulle part avant la sortie d'enclos. Une clé étrangère vers
-- `user_breeding_individuals` ne pourrait donc porter ni l'un ni l'autre. Les
-- identifiants fabriqués de `search.ts` (`couleur#M3`, `couleur+F0`) les
-- désignent déjà, et la sortie sait les relire : le JSON les garde tels quels.
create table if not exists public.breeding_batch (
  user_id uuid not null references auth.users(id) default auth.uid(),
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),

  -- Les enclos de la fournée, dans l'ordre où on les charge. Chaque entrée :
  --   { "lockedAt": "2026-08-16T09:12:00Z" | null,
  --     "units": [{ "id", "colorId", "sex", "name", "level", "banked", "toBuy" }] }
  --
  -- Le contrat est porté et validé par `lib/dofus/breeding/batch.ts`, comme celui
  -- du plan de timeline l'est par `timeline.ts` : une contrainte SQL sur du JSON
  -- figerait une forme qui bouge avec l'écran, et le client relit de toute façon
  -- l'objet entier ou rien.
  pens jsonb not null default '[]'::jsonb,

  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),

  -- Une fournée par famille : on n'a qu'un parc d'enclos, et deux fournées
  -- concurrentes sur les mêmes cinq enclos donneraient deux consignes contraires
  -- devant le même enclos. C'est la même raison que pour `breeding_timeline`.
  primary key (user_id, family)
);

comment on table public.breeding_batch is
  'La fournée en cours, enclos par enclos. Instantané pris au verrouillage : ce
   qui est dans l''enclos ne dépend plus de ce que la politique proposerait
   maintenant.';

comment on column public.breeding_batch.pens is
  'Les enclos, dans l''ordre de chargement. `lockedAt` non nul = enclos refermé,
   contenu figé. Contrat et validation dans lib/dofus/breeding/batch.ts.';

alter table public.breeding_batch enable row level security;

-- Ce qu'un joueur a dans ses enclos ne regarde que lui, comme sa timeline.
drop policy if exists "Fournée d'élevage propre" on public.breeding_batch;
create policy "Fournée d'élevage propre" on public.breeding_batch
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
