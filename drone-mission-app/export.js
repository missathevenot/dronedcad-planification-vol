/**
 * export.js
 * Export des résultats de mission : CSV, Excel (XLSX), PDF, et sauvegarde/rechargement
 * de projet au format JSON.
 */

'use strict';

const Exporter = (() => {

  function exportCSV(missions, resume) {
    const headers = ['Mission', 'Batterie', 'Surface_ha', 'Distance_m', 'Temps_min', 'Nombre_photos', 'Statut'];
    const rows = missions.map((m) => ({
      Mission: m.id, Batterie: m.batterie, Surface_ha: Utils.fmt(m.surfaceHa, 2),
      Distance_m: Utils.fmt(m.distance, 0), Temps_min: Utils.fmt(m.tempsMin, 1),
      Nombre_photos: m.photos, Statut: m.statut
    }));
    Utils.download(`missions_${Date.now()}.csv`, Utils.toCSV(rows, headers), 'text/csv;charset=utf-8');
    Utils.toast('Export CSV généré.', 'success');
  }

  function exportExcel(missions, resultats, params) {
    const wb = XLSX.utils.book_new();

    const wsMissions = XLSX.utils.json_to_sheet(missions.map((m) => ({
      Mission: m.id, Batterie: m.batterie, 'Surface (ha)': +m.surfaceHa.toFixed(2),
      'Distance (m)': Math.round(m.distance), 'Temps (min)': +m.tempsMin.toFixed(1),
      'Nombre de photos': m.photos, Statut: m.statut
    })));
    XLSX.utils.book_append_sheet(wb, wsMissions, 'Missions');

    const resumeData = resumeVersLignes(resultats, params);
    const wsResume = XLSX.utils.aoa_to_sheet(resumeData);
    XLSX.utils.book_append_sheet(wb, wsResume, 'Résumé mission');

    XLSX.writeFile(wb, `mission_drone_${Date.now()}.xlsx`);
    Utils.toast('Export Excel généré.', 'success');
  }

  /** Formate la date du jour en toutes lettres, ex. "23 Juillet 2026" */
  function dateLettresFR(d = new Date()) {
    const mois = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    return `${d.getDate()} ${mois[d.getMonth()]} ${d.getFullYear()}`;
  }

  function resumeVersLignes(r, p) {
    return [
      ['Rapport de mission — Planification photogrammétrique drone'],
      ['Généré le', Utils.now()],
      [],
      ['Paramètres drone'],
      ['Modèle', p.drone.modele],
      ['Vitesse de cartographie (m/s)', p.vol.vitesse],
      ['Altitude de vol (m AGL)', p.vol.altitude],
      ['Altitude max autorisée (m)', p.drone.altitudeMax],
      ['Autonomie par paire de batteries (min)', p.batteries.autonomieParPaireMin],
      ['Réserve de sécurité (%)', p.batteries.reserveSecuritePct],
      ['Temps de décollage (min)', p.batteries.tempsDecollageMin],
      ['Temps de retour (min)', p.batteries.tempsRetourMin],
      ['Nombre de drones', p.drone.nombreDrones],
      ['Ordinateur de traitement', p.performance.types[p.performance.typeSelectionne].nom],
      ['Coefficient de performance', r.coefficientPC],
      [],
      ['Paramètres caméra'],
      ['Modèle', p.camera.modele],
      ['Focale (mm)', p.vol.focale],
      ['Résolution (px)', `${p.camera.largeurPx} x ${p.camera.hauteurPx}`],
      [],
      ['Paramètres de vol'],
      ['Recouvrement longitudinal (%)', p.vol.recouvrementLong],
      ['Recouvrement latéral (%)', p.vol.recouvrementLat],
      ['Marge de sécurité (m)', p.vol.margeSecurite],
      [],
      ['Résultats'],
      ['Surface (ha)', +r.surfaceHa.toFixed(2)],
      ['GSD (cm/px)', +r.gsd.toFixed(2)],
      ['Empreinte photo (m)', `${r.empreinte.largeur.toFixed(1)} x ${r.empreinte.hauteur.toFixed(1)}`],
      ['Espacement des lignes (m)', +r.espacementLignes.toFixed(1)],
      ['Nombre de lignes de vol', r.nombreLignes],
      ['Distance totale (m)', Math.round(r.distanceTotale)],
      ['Temps de vol total (min)', +r.tempsVolMin.toFixed(1)],
      ['Paires de batteries', r.nbPairesMinimales],
      ['Batteries TB65 (unités)', r.nbBatteriesTB65],
      ['Nombre de missions', r.nbMissionsAutomatiques],
      ['Rotations de batteries', r.nbRotations],
      ['Décollages', r.nbDecollages],
      ['Temps total terrain (min)', +r.tempsTerrainTotalMin.toFixed(1)],
      ['Rendement (ha/h)', +r.rendementHaH.toFixed(2)],
      ['Nombre de photos', r.nombrePhotos],
      ['Volume images', Utils.fmtBytes(r.volumeImagesMo * 1024 * 1024)],
      ['Temps alignement estimé (h)', +r.tempsAlignementH.toFixed(2)],
      ['Temps nuage de points estimé (h)', +r.tempsNuageH.toFixed(2)],
      ['Temps MNS estimé (h)', +r.tempsMNSH.toFixed(2)],
      ['Temps MNT estimé (h)', +r.tempsMNTH.toFixed(2)],
      ['Temps orthophoto estimé (h)', +r.tempsOrthophotoH.toFixed(2)],
      ['Temps total de traitement estimé (h)', +r.tempsTotalH.toFixed(2)],
      ['Taille orthophoto estimée', Utils.fmtBytes(r.orthophotoMo * 1024 * 1024)],
      ['Taille nuage de points estimée', Utils.fmtBytes(r.nuagePointsMo * 1024 * 1024)],
      ['Taille MNS estimée', Utils.fmtBytes(r.mnsMo * 1024 * 1024)],
      ['Taille MNT estimée', Utils.fmtBytes(r.mntMo * 1024 * 1024)],
      ['Capacité de stockage recommandée', Utils.fmtBytes(r.stockageRecommandeMo * 1024 * 1024)],
      ['Coût total estimé', +r.coutTotal.toFixed(0)]
    ];
  }

  /** Dessine l'entête officiel (Ministère/DGI/Cadastre à gauche, République de Côte d'Ivoire à droite, logo DGI centré) en haut de la page courante */
  function dessinerEnteteOfficiel(doc, pageW) {
    const margeG = 40, margeD = pageW - 40;
    const centreGauche = margeG + (pageW / 2 - margeG) / 2;
    const centreDroit = pageW / 2 + (margeD - pageW / 2) / 2;
    const centrePage = pageW / 2;
    let yLogo = 46;

    // Logo DGI, centré horizontalement en haut de l'entête
    try {
      if (typeof DGI_LOGO_DATA_URI !== 'undefined') {
        const logoW = 58, logoH = 32;
        doc.addImage(DGI_LOGO_DATA_URI, 'PNG', centrePage - logoW / 2, yLogo - 22, logoW, logoH);
      }
    } catch (e) { console.warn('Logo DGI non chargé', e); }

    doc.setTextColor(20);

    // Bloc gauche : Ministère / DGI / Direction du Cadastre
    let yG = 32;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('MINISTERE DE L\'ECONOMIE', centreGauche, yG, { align: 'center' }); yG += 11;
    doc.text('DES FINANCES ET DU BUDGET', centreGauche, yG, { align: 'center' }); yG += 10;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('--------', centreGauche, yG, { align: 'center' }); yG += 11;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('DIRECTION GENERALE DES IMPOTS', centreGauche, yG, { align: 'center' }); yG += 10;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('--------', centreGauche, yG, { align: 'center' }); yG += 11;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('DIRECTION DU CADASTRE', centreGauche, yG, { align: 'center' }); yG += 10;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('--------', centreGauche, yG, { align: 'center' }); yG += 13;
    doc.setFont('helvetica', 'italic');
    doc.text(`Abidjan, le ${dateLettresFR()}`, centreGauche, yG, { align: 'center' });

    // Bloc droit : République de Côte d'Ivoire
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text('REPUBLIQUE DE COTE D\'IVOIRE', centreDroit, yLogo + 20, { align: 'center' });
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
    doc.text('Union – Discipline – Travail', centreDroit, yLogo + 32, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('--------', centreDroit, yLogo + 43, { align: 'center' });

    const yBas = Math.max(yLogo + 43, yG) + 12;
    doc.setDrawColor(200); doc.line(margeG, yBas, margeD, yBas);
    doc.setTextColor(20);
    return yBas + 26;
  }

  async function exportPDF(missions, resultats, params, charts) {
    Utils.toast('Génération du PDF en cours…', 'info');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = dessinerEnteteOfficiel(doc, pageW);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('PLAN PREVISIONNEL DU LEVE PHOTOGRAMMETRIQUE PAR DRONE', pageW / 2, y, { align: 'center' });
    y += 17;
    doc.text('DONNEES CARACTERISTIQUES DE LA ZONE', pageW / 2, y, { align: 'center' });
    y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(`Zone : ${params.nomZone && params.nomZone.trim() ? params.nomZone.trim() : 'Non renseignée'}`, 40, y);
    y += 16;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(`Généré le ${Utils.now()}  •  ${params.drone.modele}  +  ${params.camera.modele}  •  DroneDCAD Planification Vol`, 40, y);
    doc.setTextColor(20);
    y += 22;

    doc.setDrawColor(220); doc.line(40, y, pageW - 40, y); y += 18;

    const section = (titre) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(titre, 40, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    };
    const ligneKV = (k, v) => {
      doc.text(String(k), 46, y);
      doc.text(String(v), 260, y);
      y += 13;
      if (y > 760) { doc.addPage(); y = 48; }
    };

    section('Paramètres drone & caméra');
    ligneKV('Drone', params.drone.modele);
    ligneKV('Vitesse de cartographie', `${params.vol.vitesse} m/s`);
    ligneKV('Altitude de vol', `${params.vol.altitude} m AGL (max ${params.drone.altitudeMax} m)`);
    ligneKV('Autonomie par paire / réserve', `${params.batteries.autonomieParPaireMin} min / ${params.batteries.reserveSecuritePct} %`);
    ligneKV('Caméra', `${params.camera.modele} — ${params.camera.largeurPx}×${params.camera.hauteurPx} px`);
    ligneKV('Focale utilisée', `${params.vol.focale} mm`);
    ligneKV('Nombre de drones simultanés', params.drone.nombreDrones);
    ligneKV('Ordinateur de traitement', `${params.performance.types[params.performance.typeSelectionne].nom} (coefficient ${resultats.coefficientPC})`);
    y += 6;

    section('Paramètres de vol');
    ligneKV('Recouvrement longitudinal / latéral', `${params.vol.recouvrementLong}% / ${params.vol.recouvrementLat}%`);
    ligneKV('Marge de sécurité', `${params.vol.margeSecurite} m`);
    ligneKV('Format de capture', params.vol.formatCapture);
    y += 6;

    section('Résultats principaux');
    ligneKV('Surface couverte', `${Utils.fmt(resultats.surfaceHa, 2)} ha`);
    ligneKV('GSD', `${Utils.fmt(resultats.gsd, 2)} cm/px`);
    ligneKV('Nombre de lignes de vol', resultats.nombreLignes);
    ligneKV('Distance totale parcourue', `${Utils.fmt(resultats.distanceTotale, 0)} m`);
    ligneKV('Temps de vol total', Utils.fmtDuration(resultats.tempsVolMin));
    ligneKV('Temps total terrain (vol + changements)', Utils.fmtDuration(resultats.tempsTerrainTotalMin));
    ligneKV('Paires de batteries nécessaires', resultats.nbPairesMinimales);
    ligneKV('Batteries TB65 (unités)', resultats.nbBatteriesTB65);
    ligneKV('Nombre de missions', resultats.nbMissionsAutomatiques);
    ligneKV('Rotations de batteries', resultats.nbRotations);
    ligneKV('Décollages', resultats.nbDecollages);
    ligneKV('Rendement', `${Utils.fmt(resultats.rendementHaH, 2)} ha/h`);
    ligneKV('Nombre de photographies', resultats.nombrePhotos);
    ligneKV('Volume images estimé', Utils.fmtBytes(resultats.volumeImagesMo * 1024 * 1024));
    y += 6;

    section('Estimation des traitements photogrammétriques');
    ligneKV('Temps alignement', `${Utils.fmt(resultats.tempsAlignementH, 2)} h`);
    ligneKV('Temps nuage de points', `${Utils.fmt(resultats.tempsNuageH, 2)} h`);
    ligneKV('Temps MNS', `${Utils.fmt(resultats.tempsMNSH, 2)} h`);
    ligneKV('Temps MNT', `${Utils.fmt(resultats.tempsMNTH, 2)} h`);
    ligneKV('Temps orthophoto', `${Utils.fmt(resultats.tempsOrthophotoH, 2)} h`);
    ligneKV('Temps total de traitement', `${Utils.fmt(resultats.tempsTotalH, 2)} h`);
    ligneKV('Taille orthophoto estimée', Utils.fmtBytes(resultats.orthophotoMo * 1024 * 1024));
    ligneKV('Taille nuage de points estimée', Utils.fmtBytes(resultats.nuagePointsMo * 1024 * 1024));
    ligneKV('Taille MNS estimée', Utils.fmtBytes(resultats.mnsMo * 1024 * 1024));
    ligneKV('Taille MNT estimée', Utils.fmtBytes(resultats.mntMo * 1024 * 1024));
    ligneKV('Capacité de stockage recommandée', Utils.fmtBytes(resultats.stockageRecommandeMo * 1024 * 1024));
    if (resultats.coutTotal > 0) ligneKV('Coût total estimé', Utils.fmt(resultats.coutTotal, 0));
    y += 10;

    // Tableau des missions
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('Tableau des missions', 40, y); y += 8;
    doc.autoTable({
      startY: y,
      head: [['Mission', 'Batterie', 'Surface (ha)', 'Distance (m)', 'Temps (min)', 'Photos', 'Statut']],
      body: missions.map((m) => [m.id, m.batterie, m.surfaceHa.toFixed(2), Math.round(m.distance), m.tempsMin.toFixed(1), m.photos, m.statut]),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [18, 27, 46] },
      margin: { left: 40, right: 40 }
    });
    y = doc.lastAutoTable.finalY + 24;

    // Capture de la carte
    try {
      const mapEl = document.getElementById('map');
      const canvasMap = await html2canvas(mapEl, { useCORS: true, backgroundColor: null, scale: 1.3 });
      if (y > 480) { doc.addPage(); y = 48; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text('Carte des lignes de vol', 40, y); y += 8;
      const imgData = canvasMap.toDataURL('image/jpeg', 0.85);
      const ratio = canvasMap.height / canvasMap.width;
      const w = pageW - 80;
      const h = w * ratio;
      doc.addImage(imgData, 'JPEG', 40, y, w, Math.min(h, 300));
      y += Math.min(h, 300) + 20;
    } catch (e) { console.warn('Capture carte échouée', e); }

    // Graphiques
    if (charts) {
      for (const [titre, canvas] of Object.entries(charts)) {
        if (!canvas) continue;
        if (y > 560) { doc.addPage(); y = 48; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(titre, 40, y); y += 8;
        const img = canvas.toDataURL('image/png', 1.0);
        doc.addImage(img, 'PNG', 40, y, 240, 150);
        y += 165;
      }
    }

    doc.save(`rapport_mission_${Date.now()}.pdf`);
    Utils.toast('Rapport PDF généré.', 'success');
  }

  function sauvegarderProjet(state) {
    const json = JSON.stringify(state, null, 2);
    Utils.download(`projet_mission_${Date.now()}.json`, json, 'application/json');
    Utils.toast('Projet sauvegardé (.json).', 'success');
  }

  async function chargerProjet(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  return { exportCSV, exportExcel, exportPDF, sauvegarderProjet, chargerProjet };
})();
