# Mes Parcelles — PWA

Application web installable pour répertorier tes parcelles de bois/terrains
(données IGN + cadastre officielles) et suivre tes prospections.

## Ce que contient ce dossier

- `index.html`, `styles.css`, `app.js`, `db.js`, `sw.js`, `manifest.webmanifest`
- `icons/` — icônes de l'app

Aucune dépendance à installer, aucun build : c'est du HTML/JS/CSS pur.
Les seules librairies externes (Leaflet, icônes Tabler) sont chargées depuis un CDN.

## Stockage des données

100% local sur l'appareil, via IndexedDB. Rien n'est envoyé sur un serveur.
Conséquence : les données ne sont PAS partagées entre ton téléphone et celui
d'un proche — chacun a sa propre base. Pense à utiliser le bouton "Exporter
mes données" (menu en haut à droite) régulièrement pour avoir une sauvegarde.

## Pourquoi un serveur est nécessaire pour tester sur mobile

Les PWA doivent être servies en HTTPS (ou localhost) pour fonctionner
correctement (service worker, installation, géolocalisation). On ne peut pas
juste ouvrir `index.html` en double-cliquant dessus.

## Option recommandée — déploiement gratuit en 2 minutes (Netlify Drop)

1. Va sur https://app.netlify.com/drop
2. Glisse-dépose le dossier entier `parcelles-pwa` sur la page
3. Netlify te donne une URL en `https://xxxx.netlify.app`
4. Ouvre cette URL sur ton téléphone (Chrome sur Android, Safari sur iOS)
5. Un bandeau "Installer l'application" doit apparaître en bas de l'écran
   (sur iOS Safari : bouton Partager → "Sur l'écran d'accueil")

Aucun compte requis pour un dépôt simple, gratuit, et ça te donne une URL
stable que tu peux aussi partager à tes proches pour qu'ils installent
l'app sur leur propre téléphone (avec leurs propres données locales).

## Option alternative — tester en local sur ton réseau Wi-Fi

Si tu as Python installé sur ton ordinateur :

```bash
cd parcelles-pwa
python3 -m http.server 8000
```

Puis trouve l'adresse IP locale de ton ordinateur (ex. 192.168.1.20) et
ouvre `http://192.168.1.20:8000` depuis ton téléphone connecté au même
Wi-Fi. Limite : pas de HTTPS, donc l'installation PWA et la géolocalisation
peuvent être limitées selon le navigateur.

## Option pérenne — GitHub Pages (gratuit, durable)

1. Crée un dépôt GitHub (peut être privé)
2. Pousse le contenu de ce dossier à la racine du dépôt
3. Active GitHub Pages dans Settings → Pages → branche main
4. Ton app sera accessible à `https://tonpseudo.github.io/nom-du-depot/`

C'est l'option la plus stable dans la durée si tu comptes utiliser l'app
sur plusieurs mois/années.

## Limites connues de cette version

- Pas de cache hors-ligne des tuiles de carte avant la première visite
  d'une zone (le hors-ligne s'améliore au fur et à mesure que tu consultes
  des zones en ligne)
- Pas de dessin manuel de parcelle si elle n'existe pas au cadastre
- Pas de photos dans le carnet de terrain
- Pas de synchronisation entre appareils

Ce sont des pistes naturelles pour une prochaine itération si l'usage
te convient.
