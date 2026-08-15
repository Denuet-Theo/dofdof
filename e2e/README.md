# Tests de bout en bout

```bash
npm run test:e2e          # la suite
npm run test:e2e:ui       # le mode interactif de Playwright
```

Playwright démarre lui-même un serveur Next sur le port **3100** — distinct du
3000 des sessions de développement, pour ne pas avoir à l'arrêter.

## Ce que la suite couvre, et pourquoi celle-là

Chaque test correspond à une panne **qui s'est produite en production**, pas à
une inquiétude. Toutes concernent la même chose : une écriture qu'on croit
faite et qui ne l'est pas.

| Fichier | Panne d'origine |
| --- | --- |
| `birth-recording.spec.ts` | 15/08/2026, 12:44 — l'insertion de 22 poulains échoue, les 44 parents passent stériles quand même, la fenêtre annonce le succès. 22 montures perdues. |
| `birth-recording.spec.ts` | Le correctif de la précédente : chaque clic écrit, donc l'écurie change, donc la fournée se recalcule entre deux clics et les naissances changent de panneau. |

## Les trois choix qui font que ça attrape quelque chose

**Supabase est simulé au réseau, pas remplacé par une vraie base.** Non par
paresse : c'est ce qui permet de **refuser une écriture précise à un moment
précis**. Un test incapable de faire échouer une insertion n'aurait rien vu de
la panne du 15/08. Voir `support/supabase.ts`.

**Le faux serveur a de l'état.** Les parcours écrivent puis relisent — une
naissance s'ajoute, ses parents passent stériles, l'annulation défait les trois.
Un mock qui rejoue toujours la fixture dirait « vert » sur une annulation qui
n'annule rien.

**La fixture est une vraie écurie**, celle du 15/08, anonymisée — 203 montures.
Une écurie inventée de six montures ne vaut rien aux yeux de la politique, qui
ne propose alors aucune fournée : il n'y a rien à saisir, donc rien à tester.
Aucune donnée personnelle n'y subsiste (ni compte, ni email, ni identifiant).

## Écrire un nouveau test

Deux règles, apprises cher — voir `AGENTS.md` :

1. **Clique deux fois.** La régression qui a suivi le premier correctif
   n'apparaît qu'au deuxième clic, quand la première écriture a changé l'écurie.
2. **Prouve que le test échoue sur le bug.** Remets le défaut, regarde le test
   rougir, remets le correctif. Une suite verte qui reste verte avec le bug est
   une décoration.
