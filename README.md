# Salon privé — messagerie chiffrée de bout en bout

Une page statique + une fonction Netlify. Le chiffrement se fait entièrement dans le navigateur :
le serveur ne reçoit que des blocs binaires et un identifiant de salon opaque.

```
tchat/
├─ public/index.html            l'application entière (aucune dépendance)
├─ netlify/functions/messages.mjs   relais de messages chiffrés (Netlify Blobs)
├─ netlify.toml                 build, en-têtes de sécurité, CSP
└─ package.json                 dépendance @netlify/blobs
```

## Comment ça marche

1. Chacun saisit le **nom du salon** et une **phrase secrète** communs.
2. Le navigateur dérive 512 bits par PBKDF2-SHA256 (310 000 itérations) :
   la première moitié donne l'identifiant de salon envoyé au serveur, la seconde la clé AES-256-GCM,
   qui ne quitte jamais l'appareil.
3. Chaque message est chiffré (nom d'auteur compris) avec un vecteur d'initialisation aléatoire,
   puis déposé dans Netlify Blobs sous une clé horodatée.
4. Les autres onglets interrogent le serveur toutes les 2,5 s et déchiffrent localement.
   Les messages sont supprimés automatiquement au bout de 48 h.

## Déploiement

**Par l'interface Netlify (le plus simple)**

1. Poussez ce dossier sur un dépôt GitHub / GitLab.
2. Sur Netlify : *Add new site → Import an existing project*, sélectionnez le dépôt.
3. Laissez les réglages tels quels : `netlify.toml` fixe déjà le dossier publié (`public`)
   et le dossier des fonctions. Aucune commande de build, aucune variable d'environnement.
4. Déployez. Netlify Blobs s'active tout seul sur les sites récents.

**Par la ligne de commande**

```bash
npm install -g netlify-cli
npm install          # récupère @netlify/blobs
netlify dev          # essai local sur http://localhost:8888
netlify deploy --prod
```

Ouvrez le site dans deux navigateurs, entrez le même salon et la même phrase secrète : la conversation circule.

## Ce que ce système protège, et ce qu'il ne protège pas

**Protégé**

- Le contenu des messages et le nom des auteurs, y compris vis-à-vis de Netlify et de toute personne qui accéderait au stockage.
- Le nom du salon et la phrase secrète, qui ne transitent jamais sur le réseau.
- L'accès : sans la phrase secrète, l'identifiant du salon est impossible à deviner (2^256 possibilités).

**Non protégé**

- **Les métadonnées.** Netlify voit les adresses IP, les horaires et la taille des messages.
- **L'identité des participants.** Toute personne qui connaît la phrase secrète peut écrire sous n'importe quel nom : il n'y a pas de signature par personne.
- **Le passé.** Pas de confidentialité persistante : si la phrase secrète fuite, les messages encore stockés (48 h) deviennent lisibles.
- **Les appareils.** Un poste compromis ou un collègue qui regarde l'écran, c'est hors de portée du chiffrement.
- **Le code servi.** Vous faites confiance à Netlify pour servir cette page non modifiée. C'est la limite commune à toutes les messageries web.

Choisissez une phrase secrète longue et aléatoire — c'est elle, et elle seule, qui tient toute la sécurité.
Pour des échanges réellement sensibles (données personnelles, secrets industriels, contexte juridique),
préférez un outil audité comme Signal, Matrix/Element ou Wire : ils apportent l'authentification des
participants et la confidentialité persistante que ce petit projet n'a pas.

## Réglages utiles

| Où | Quoi |
|---|---|
| `messages.mjs` → `RETENTION_MS` | durée de conservation (48 h par défaut) |
| `messages.mjs` → `MAX_PAYLOAD` | taille maximale d'un message chiffré |
| `index.html` → `POLL_MS` | fréquence d'interrogation du serveur |
| `index.html` → `ITERATIONS` | coût de la dérivation de clé (à garder identique pour tous) |

Le bouton « Effacer le salon » supprime immédiatement tous les messages du salon, pour tout le monde.
