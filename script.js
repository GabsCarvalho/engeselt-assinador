/* ===== Initial state & helpers ===== */
const sigFile = document.getElementById('sigFile');
const sigPreviewCanvas = document.getElementById('sigPreviewCanvas');
const sigPreviewCtx = sigPreviewCanvas.getContext('2d');
const applyRemoveBtn = document.getElementById('applyRemove');
const restoreBgBtn = document.getElementById('restoreBg');
const toleranceSlider = document.getElementById('tolerance');
const tolVal = document.getElementById('tolVal');
const sigFmt = document.getElementById('sigFmt');
const pdfFilesInput = document.getElementById('pdfFiles');
const openEditorBtn = document.getElementById('openEditor');
const applyAllBtn = document.getElementById('applyAll');
const pdfCanvas = document.getElementById('pdfCanvas');
const pdfCtx = pdfCanvas.getContext('2d');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const rotLeft = document.getElementById('rotLeft');
const rotRight = document.getElementById('rotRight');
const rotDegEl = document.getElementById('rotDeg');
const coordX = document.getElementById('coordX');
const coordY = document.getElementById('coordY');
const coordW = document.getElementById('coordW');
const coordH = document.getElementById('coordH');
const status = document.getElementById('status');

let signatureImg = new Image();
let signatureOrig = null; // Image object original
let signatureProcessedDataURL = null; // after bg removal
let signatureMime = null;
let pdfPage, viewport, firstPdfFile;
let sig = { x: 400, y: 600, w: 140, h: 50, rot: 0 };
let dragging = false, dragOffset={x:0,y:0};

let refVisualWidth; // <-- ADICIONE AQUI
let refVisualHeight; // <-- ADICIONE AQUI

/* base64 -> arrayBuffer utility robust */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i]=binaryString.charCodeAt(i);
  return bytes.buffer;
}

/* draw signature onto preview canvas (with transparent background) */
function drawSigPreview(dataURL) {
  const ctx = sigPreviewCtx;
  const c = sigPreviewCanvas;
  const img = new Image();
  img.onload = () => {
    // clear
    ctx.clearRect(0,0,c.width,c.height);
    // fit image centered
    const ratio = Math.min((c.width-10)/img.width, (c.height-10)/img.height);
    const dw = img.width * ratio;
    const dh = img.height * ratio;
    const dx = (c.width - dw)/2;
    const dy = (c.height - dh)/2;
    ctx.drawImage(img, dx, dy, dw, dh);
  };
  img.src = dataURL;
}

/* Remove background using tolerance: pixels with r,g,b > tolerance -> alpha=0 */
function removeBackgroundFromDataURL(dataURL, tolerance) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const temp = document.createElement('canvas');
      temp.width = img.width; temp.height = img.height;
      const tctx = temp.getContext('2d');
      tctx.drawImage(img,0,0);
      const imgData = tctx.getImageData(0,0,temp.width,temp.height);
      const d = imgData.data;
      for (let i=0;i<d.length;i+=4) {
        const r=d[i], g=d[i+1], b=d[i+2];
        // If all channels above tolerance -> consider background -> make transparent
        if (r >= tolerance && g >= tolerance && b >= tolerance) {
          d[i+3]=0;
        }
      }
      tctx.putImageData(imgData,0,0);
      res(temp.toDataURL('image/png'));
    };
    img.onerror = (e)=>rej(e);
    img.src = dataURL;
  });
}

/* restore original */
function restoreOriginalSig() {
  if (!signatureOrig) return;
  const dataURL = signatureOrig.src;
  signatureProcessedDataURL = dataURL;
  signatureImg.src = dataURL;
  signatureMime = dataURL.split(';')[0].split(':')[1];
  drawSigPreview(signatureProcessedDataURL);
}

/* ===== Events: signature file load & preview ===== */
sigFile.addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    signatureOrig = new Image();
    signatureOrig.onload = () => {
      signatureProcessedDataURL = signatureOrig.src;
      signatureImg.src = signatureProcessedDataURL;
      signatureMime = f.type || (signatureProcessedDataURL.split(';')[0].split(':')[1]||'image/png');
      sigFmt.textContent = signatureMime.split('/')[1] || 'png';
      drawSigPreview(signatureProcessedDataURL);
      status.textContent = 'Assinatura carregada';
      applyAllBtn.disabled = (pdfFilesInput.files.length===0);
    };
    signatureOrig.src = reader.result;
  };
  reader.readAsDataURL(f);
});

/* tolerance slider */
tolerance.addEventListener('input', ()=> {
  tolVal.textContent = tolerance.value;
});

/* apply remove preview */
applyRemoveBtn.addEventListener('click', async ()=>{
  if (!signatureProcessedDataURL) return alert('Carregue a assinatura primeiro.');
  const tol = parseInt(tolerance.value,10);
  status.textContent = 'Removendo fundo (preview)...';
  try {
    const newDataURL = await removeBackgroundFromDataURL(signatureProcessedDataURL, tol);
    signatureProcessedDataURL = newDataURL;
    signatureImg.src = signatureProcessedDataURL;
    drawSigPreview(signatureProcessedDataURL);
    status.textContent = 'Fundo removido (preview).';
  } catch (err) {
    console.error(err);
    alert('Erro ao processar imagem: '+err);
    status.textContent = 'Erro ao remover fundo';
  }
});

/* restore */
restoreBgBtn.addEventListener('click', ()=> {
  restoreOriginalSig();
  status.textContent = 'Imagem original restaurada';
});

/* ===== Editor com canvas duplo (PDF + assinatura flutuante) ===== */
const sigCanvas = document.createElement('canvas');
const sigCtx = sigCanvas.getContext('2d');
sigCanvas.style.position = 'absolute';
sigCanvas.style.top = '0';
sigCanvas.style.left = '0';
sigCanvas.style.pointerEvents = 'auto';
sigCanvas.style.display = 'none';
sigCanvas.style.borderRadius = '8px';
sigCanvas.style.background = 'transparent';
pdfCanvas.parentElement.style.position = 'relative';
pdfCanvas.parentElement.appendChild(sigCanvas);

/* ===== Substitua sua função openEditorBtn por esta ===== */
openEditorBtn.addEventListener('click', async ()=>{
  if (!pdfFilesInput.files.length) return alert('Selecione ao menos 1 PDF.');
  if (!signatureProcessedDataURL) return alert('Carregue e processe a assinatura primeiro.');
  firstPdfFile = pdfFilesInput.files[0];
  status.textContent = `Abrindo ${firstPdfFile.name}...`;
  const arr = await firstPdfFile.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({data:arr});
  const pdf = await loadingTask.promise;
  pdfPage = await pdf.getPage(1);

  // Lógica de escala corrigida e unificada
  const desiredScale = 1.5;
  const maxWidth = 1100; // O limite do seu <section>

  // Pega o viewport com escala 1.0 para descobrir as dimensões VISUAIS
  // (Isso já lida com a rotação do PDF)
  const unscaledViewport = pdfPage.getViewport({ scale: 1.0 });
  
  // Salva as dimensões VISUAIS para usar no salvamento
  // (Esta é a correção chave que faltava)
  pdfPage.__visualWidth = unscaledViewport.width;
  pdfPage.__visualHeight = unscaledViewport.height;

  let actualScale = desiredScale;
  
  // Se a largura visual (com escala desejada) ultrapassar o limite...
  if (pdfPage.__visualWidth * desiredScale > maxWidth) {
      // Calcula a escala real para caber exatamente no limite
      actualScale = maxWidth / pdfPage.__visualWidth;
  }
  
  // Crie o viewport final com a escala real e correta
  viewport = pdfPage.getViewport({ scale: actualScale });
  // Fim da lógica de escala

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  sigCanvas.width = pdfCanvas.width;
  sigCanvas.height = pdfCanvas.height;
  sigCanvas.style.display = 'block';
  pdfCanvas.style.display = 'block';

  // Render PDF apenas uma vez
  await pdfPage.render({canvasContext:pdfCtx, viewport}).promise;

  drawSignatureOnly();
  status.textContent = 'Editor aberto — arraste, redimensione e gire a assinatura.';
  applyAllBtn.disabled = false;
});

/* === Função para redesenhar apenas a assinatura === */
function drawSignatureOnly() {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  const img = new Image();
  img.onload = () => {
    sigCtx.save();
    sigCtx.translate(sig.x + sig.w/2, sig.y + sig.h/2);
    sigCtx.rotate(sig.rot * Math.PI / 180);
    sigCtx.drawImage(img, -sig.w/2, -sig.h/2, sig.w, sig.h);
    sigCtx.restore();

    coordX.textContent = Math.round(sig.x);
    coordY.textContent = Math.round(sig.y);
    coordW.textContent = Math.round(sig.w);
    coordH.textContent = Math.round(sig.h);
    rotDegEl.textContent = Math.round(sig.rot);
  };
  img.src = signatureProcessedDataURL || signatureOrig.src;
}

/* === Arraste fluido (sem re-renderizar o PDF) === */
/* Use nomes únicos para evitar redeclaração de variáveis já existentes */
let draggingSig = false;
let dragStart = { x: 0, y: 0 };

sigCanvas.addEventListener('mousedown', e => {
  const rect = sigCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  // teste se clicou dentro da área da assinatura
  if (mx >= sig.x && mx <= sig.x + sig.w && my >= sig.y && my <= sig.y + sig.h) {
    draggingSig = true;
    dragStart.x = mx - sig.x;
    dragStart.y = my - sig.y;
  }
});

window.addEventListener('mouseup', () => { draggingSig = false; });

sigCanvas.addEventListener('mousemove', e => {
  if (!draggingSig) return;
  const rect = sigCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  sig.x = mx - dragStart.x;
  sig.y = my - dragStart.y;
  drawSignatureOnly();
});

/* === Redimensionar com scroll do mouse === */
sigCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.07 : 0.93;

  // Mantém o centro fixo durante o redimensionamento
  const centerX = sig.x + sig.w / 2;
  const centerY = sig.y + sig.h / 2;

  sig.w *= factor;
  sig.h *= factor;

  sig.x = centerX - sig.w / 2;
  sig.y = centerY - sig.h / 2;

  drawSignatureOnly();
});

/* === Rotação e zoom continuam iguais === */
zoomIn.addEventListener('click', () => {
  const centerX = sig.x + sig.w / 2;
  const centerY = sig.y + sig.h / 2;
  sig.w *= 1.1;
  sig.h *= 1.1;
  sig.x = centerX - sig.w / 2;
  sig.y = centerY - sig.h / 2;
  drawSignatureOnly();
});

zoomOut.addEventListener('click', () => {
  const centerX = sig.x + sig.w / 2;
  const centerY = sig.y + sig.h / 2;
  sig.w *= 0.9;
  sig.h *= 0.9;
  sig.x = centerX - sig.w / 2;
  sig.y = centerY - sig.h / 2;
  drawSignatureOnly();
});
rotLeft.addEventListener('click', () => { sig.rot = (sig.rot - 5) % 360; drawSignatureOnly(); });
rotRight.addEventListener('click', () => { sig.rot = (sig.rot + 5) % 360; drawSignatureOnly(); });

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { sig.rot = (sig.rot - 3) % 360; drawSignatureOnly(); }
  if (e.key === 'ArrowRight') { sig.rot = (sig.rot + 3) % 360; drawSignatureOnly(); }
});

/* Save coordinates in localStorage */
document.getElementById('saveCoords').addEventListener('click', ()=>{
  localStorage.setItem('eng_sig_coords', JSON.stringify(sig));
  status.textContent = 'Coordenadas salvas localmente.';
});
/* If saved coords exist, load them */
const saved = localStorage.getItem('eng_sig_coords');
if (saved){ try{ sig = JSON.parse(saved); }catch(e){} }

/* ===== Apply to all PDFs & download ZIP ===== */
/* ===== Substitua sua função applyAllBtn por esta ===== */
applyAllBtn.addEventListener('click', async () => {
  if (!pdfFilesInput.files.length) return alert('Selecione PDFs.');
  if (!signatureProcessedDataURL) return alert('Assinatura ausente.');
  status.textContent = 'Processando lote...';
  applyAllBtn.disabled = true;

  // Converter assinatura para arrayBuffer (sem fetch)
  const dataURL = signatureProcessedDataURL || (signatureOrig && signatureOrig.src);
  const base64 = dataURL.split(',')[1];
  const arrayBuffer = base64ToArrayBuffer(base64);
  const isPng = dataURL.includes('image/png');

  const zip = new JSZip();
  const files = Array.from(pdfFilesInput.files);

  // CORREÇÃO: Pega as dimensões VISUAIS que o editor usou
  const refWidth = pdfPage.__visualWidth;
  const refHeight = pdfPage.__visualHeight;
  const scale = viewport.scale || 1; // A escala real do editor

  // Converte de pixels (tela) para pontos (PDF visual)
  const sigRealX = sig.x / scale;
  const sigRealY = sig.y / scale;
  const sigRealW = sig.w / scale;
  const sigRealH = sig.h / scale;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = `Assinando ${file.name} (${i + 1}/${files.length})...`;

    try {
      const buffer = await file.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();
      const lastPage = pages[pages.length - 1];
    
      // Pega as dimensões VISUAIS do PDF de destino
      const { width: rawPdfWidth, height: rawPdfHeight } = lastPage.getSize();
      const rotation = lastPage.getRotation().angle;
      
      let pdfWidth, pdfHeight;
      if (rotation === 90 || rotation === 270) {
        pdfWidth = rawPdfHeight;
        pdfHeight = rawPdfWidth;
      } else {
        pdfWidth = rawPdfWidth;
        pdfHeight = rawPdfHeight;
      }

      // Calcula a proporção entre o PDF de referência e o PDF de destino
      const scaleX = pdfWidth / refWidth;
      const scaleY = pdfHeight / refHeight;

      // Calcula as dimensões e posições finais
      const pdfSigW = sigRealW * scaleX;
      const pdfSigH = sigRealH * scaleX; // Usa scaleX para manter a proporção
      const pdfSigX = (sigRealX * scaleX) - (-40 * scaleX);
      // Inverte o Y: AlturaTotal - (PosY_do_Topo * Escala) - AlturaAssinatura
      const pdfSigY = pdfHeight - (sigRealY * scaleY) - pdfSigH - (62 * scaleY);

      const img = isPng
        ? await pdfDoc.embedPng(arrayBuffer)
        : await pdfDoc.embedJpg(arrayBuffer);

      lastPage.drawImage(img, {
        x: pdfSigX,
        y: pdfSigY,
        width: pdfSigW,
        height: pdfSigH,
        rotate: PDFLib.degrees(-sig.rot) // Rotação invertida
      });

      const pdfBytes = await pdfDoc.save();
      zip.file(file.name.replace(/\.pdf$/i, '') + '_assinado.pdf', pdfBytes);
    } catch (err) {
      console.error('Erro ao assinar', file.name, err);
      alert(`Erro ao processar ${file.name}: ${err.message}`);
    }
  }

  status.textContent = 'Gerando ZIP...';
  const blob = await zip.generateAsync({ type: 'blob' });
  const date = new Date().toISOString().split('T')[0];
  
  // ⬇️ Nova forma (abre diálogo nativo de salvar)
  try {
    const handle = await window.showSaveFilePicker({
        suggestedName: `Folhas_Assinadas_${date}.zip`,
        types: [{
        description: 'Arquivo ZIP',
        accept: { 'application/zip': ['.zip'] },
        }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    status.textContent = 'Arquivo salvo com sucesso ✅';
    } catch (err) {
        if (err.name !== 'AbortError') {
            alert('Erro ao salvar o arquivo: ' + err.message);
        } else {
            status.textContent = 'Salvamento cancelado.';
        }
    }

});


/* small helpers: enable applyAll when both signature + pdfs exist */
pdfFilesInput.addEventListener('change', ()=> {
  applyAllBtn.disabled = !(pdfFilesInput.files.length && signatureProcessedDataURL);
  status.textContent = pdfFilesInput.files.length ? `${pdfFilesInput.files.length} PDF(s) carregado(s)` : 'Nenhum PDF';
});