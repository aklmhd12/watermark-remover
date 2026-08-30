/*
 * Almate Authorized Multi-Brand Watermark Remover
 * Browser-only GitHub Pages application.
 *
 * Scope:
 * - Removes only configured owned-brand PDF TEXT watermark operations.
 * - Does not add any new watermark/footer/logo/page number.
 * - Does not rasterize pages.
 * - Verifies that configured text watermark operations are gone before download.
 * - Uses the original uploaded filename.
 *
 * Note: A watermark that is permanently baked into a scanned page image is not
 * destructively erased by this conservative build. That needs a dedicated,
 * separately validated image-cleaning profile for that source PDF family.
 */

(() => {
  'use strict';

  const {
    PDFDocument,
    PDFName,
    PDFArray,
    PDFRawStream,
    PDFRef,
    decodePDFRawStream,
  } = PDFLib;

  const CONFIG = {
    maxFileBytes: 120 * 1024 * 1024,

    // Allowlisted owned/authorized branding patterns.
    targets: [
      {
        id: 'tamilguru',
        label: 'TamilGuru.lk',
        terms: [
          'tamilguru.lk',
          'www.tamilguru.lk',
          'more past papers at tamilguru.lk',
          'more past papers at tamilguru',
        ],
        // Known custom-font hex signatures observed in supplied TamilGuru PDFs.
        hexSignatures: [
          '00300052005500480003003300440056005700030033004400530048005500560003004400570003005700440050004C004F004A0058005500580011004F004E',
          '00300052005500480003003300440056005700030033004400530048005500560003004400570003',
          '005700440050004C004F004A0058005500580011004F004E',
        ],
      },
      {
        id: 'pastpaperswiki',
        label: 'PastPapers.Wiki',
        terms: [
          'pastpapers.wiki',
          'www.pastpapers.wiki',
          'past papers wiki',
          "downloaded from 'past papers wiki'",
          'downloaded from past papers wiki',
          'most extensive wikipedia of past papers',
          'extensive collection of past papers',
          'extensive collection of past papers, notes and much more',
        ],
        hexSignatures: [],
      },
      {
        id: 'ekalvi',
        label: 'e-kalvi.com',
        terms: [
          'e-kalvi.com',
          'www.e-kalvi.com',
          'ekalvi.com',
          'www.ekalvi.com',
        ],
        hexSignatures: [],
      },
      {
        id: 'alevelapi',
        label: 'AlevelAPI.com',
        terms: [
          'alevelapi.com',
          'www.alevelapi.com',
          'a level api.com',
        ],
        hexSignatures: [],
      },
      {
        id: 'gurupiyasa',
        label: 'GuruPiyasa.guru',
        terms: [
          'gurupiyasa.guru',
          'www.gurupiyasa.guru',
          'guru piyasa.guru',
          'sri lanka biggest past paper collection',
        ],
        hexSignatures: [],
      },
    ],
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    file: $('pdfFile'),
    drop: $('dropZone'),
    browse: $('browseBtn'),
    reset: $('resetBtn'),
    download: $('downloadBtn'),
    fileMeta: $('fileMeta'),
    status: $('statusPill'),
    empty: $('emptyState'),
    progressWrap: $('progressWrap'),
    progressLabel: $('progressLabel'),
    progressPercent: $('progressPercent'),
    progressBar: $('progressBar'),
    summary: $('summary'),
    statPages: $('statPages'),
    statAffected: $('statAffected'),
    statHits: $('statHits'),
    statSize: $('statSize'),
    brandSummary: $('brandSummary'),
    pageList: $('pageList'),
    result: $('resultBox'),
    resultText: $('resultText'),
    error: $('errorBox'),
  };

  let selectedFile = null;
  let sourceBytes = null;
  let cleanedBytes = null;
  let outputUrl = null;
  let busy = false;

  function fmtBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function bytesToLatin1(bytes) {
    let result = '';
    const chunk = 16384;
    for (let i = 0; i < bytes.length; i += chunk) {
      result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return result;
  }

  function cleanHex(hex) {
    return String(hex || '').replace(/\s+/g, '').toUpperCase();
  }

  function hexToBytes(hex) {
    const normalized = cleanHex(hex);
    if (!normalized || normalized.length % 2 !== 0 || /[^0-9A-F]/.test(normalized)) return null;
    const out = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
      out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
    }
    return out;
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findTargetInText(text) {
    const lower = normalizeText(text);
    if (!lower) return null;
    for (const target of CONFIG.targets) {
      for (const term of target.terms) {
        if (lower.includes(term.toLowerCase())) return target;
      }
    }
    return null;
  }

  function decodePdfLiteral(rawLiteral) {
    if (!rawLiteral || rawLiteral[0] !== '(') return '';
    let body = rawLiteral.slice(1, -1);
    body = body
      .replace(/\\\r?\n/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8) & 0xff));
    return body;
  }

  function targetFromHexOperand(hex) {
    const normalized = cleanHex(hex);
    if (!normalized) return null;

    for (const target of CONFIG.targets) {
      if (target.hexSignatures.some((signature) => normalized.includes(signature))) return target;
    }

    const bytes = hexToBytes(normalized);
    if (!bytes) return null;

    const latin = bytesToLatin1(bytes);
    let found = findTargetInText(latin);
    if (found) return found;

    // Common UTF-16BE-style text operands.
    if (bytes.length % 2 === 0) {
      const codes = [];
      for (let i = 0; i < bytes.length; i += 2) {
        codes.push((bytes[i] << 8) | bytes[i + 1]);
      }

      const direct = codes.map((code) => (code >= 0 && code < 128 ? String.fromCharCode(code) : '?')).join('');
      found = findTargetInText(direct);
      if (found) return found;

      // Some supplied PDFs use a consistently shifted custom encoding.
      for (let shift = -64; shift <= 64; shift += 1) {
        let candidate = '';
        for (const code of codes) {
          const shifted = code + shift;
          candidate += shifted >= 0 && shifted < 128 ? String.fromCharCode(shifted) : '?';
        }
        found = findTargetInText(candidate);
        if (found) return found;
      }
    }

    return null;
  }

  function targetFromStringOperand(operand) {
    if (!operand) return null;
    if (operand[0] === '<') return targetFromHexOperand(operand.slice(1, -1));
    if (operand[0] === '(') return findTargetInText(decodePdfLiteral(operand));
    return null;
  }

  function targetFromArrayOperand(arrayText) {
    const foundTargets = [];

    const hexRegex = /<([0-9A-Fa-f\s]+)>/g;
    let match;
    while ((match = hexRegex.exec(arrayText)) !== null) {
      const target = targetFromHexOperand(match[1]);
      if (target) foundTargets.push(target);
    }

    const literalRegex = /\((?:\\.|[^\\)])*\)/g;
    while ((match = literalRegex.exec(arrayText)) !== null) {
      const target = findTargetInText(decodePdfLiteral(match[0]));
      if (target) foundTargets.push(target);
    }

    if (foundTargets.length) return foundTargets[0];

    // If a domain/phrase is split across several strings in a TJ array,
    // concatenate textual pieces and try one conservative match.
    let combined = '';
    hexRegex.lastIndex = 0;
    while ((match = hexRegex.exec(arrayText)) !== null) {
      const bytes = hexToBytes(match[1]);
      if (bytes) combined += bytesToLatin1(bytes);
    }
    literalRegex.lastIndex = 0;
    while ((match = literalRegex.exec(arrayText)) !== null) {
      combined += decodePdfLiteral(match[0]);
    }
    return findTargetInText(combined);
  }

  function incrementBrand(counts, target) {
    if (!target) return;
    counts[target.id] = (counts[target.id] || 0) + 1;
  }

  function inspectAndOptionallyCleanContent(text, remove) {
    let hits = 0;
    let output = text;
    const brandCounts = {};

    const replaceIfTarget = (full, target) => {
      if (!target) return full;
      hits += 1;
      incrementBrand(brandCounts, target);
      return remove ? '' : full;
    };

    // Simple string show: (...) Tj or <...> Tj
    const tjRegex = /(<[0-9A-Fa-f\s]+>|\((?:\\.|[^\\)])*\))\s*Tj\b/g;
    output = output.replace(tjRegex, (full, operand) => replaceIfTarget(full, targetFromStringOperand(operand)));

    // Array show: [ (...) 20 <...> ] TJ
    const tjArrayRegex = /\[((?:[^\]\[]|\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>)*)\]\s*TJ\b/g;
    output = output.replace(tjArrayRegex, (full, body) => replaceIfTarget(full, targetFromArrayOperand(body)));

    // Apostrophe operator: (...) '
    const quoteRegex = /(<[0-9A-Fa-f\s]+>|\((?:\\.|[^\\)])*\))\s*'/g;
    output = output.replace(quoteRegex, (full, operand) => replaceIfTarget(full, targetFromStringOperand(operand)));

    // Double-quote operator: word spacing + char spacing + string + "
    const doubleQuoteRegex = /[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+(<[0-9A-Fa-f\s]+>|\((?:\\.|[^\\)])*\))\s*"/g;
    output = output.replace(doubleQuoteRegex, (full, operand) => replaceIfTarget(full, targetFromStringOperand(operand)));

    return { hits, text: output, modified: remove && output !== text, brandCounts };
  }

  function mergeCounts(into, from) {
    for (const [key, value] of Object.entries(from || {})) {
      into[key] = (into[key] || 0) + value;
    }
  }

  function getPageContentEntries(pdfDoc, page) {
    const contentsKey = PDFName.of('Contents');
    const rawNode = page.node.get(contentsKey);
    if (!rawNode) return [];

    const resolved = pdfDoc.context.lookup(rawNode);
    const entries = [];

    if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i += 1) {
        const childNode = resolved.get(i);
        const stream = pdfDoc.context.lookup(childNode);
        if (stream instanceof PDFRawStream) {
          entries.push({
            stream,
            ref: childNode instanceof PDFRef ? childNode : null,
            array: resolved,
            arrayIndex: i,
            contentsKey,
          });
        }
      }
      return entries;
    }

    if (resolved instanceof PDFRawStream) {
      entries.push({
        stream: resolved,
        ref: rawNode instanceof PDFRef ? rawNode : null,
        array: null,
        arrayIndex: null,
        contentsKey,
      });
    }

    return entries;
  }

  function decodeStream(stream) {
    const decoded = decodePDFRawStream(stream).decode();
    return bytesToLatin1(decoded);
  }

  function replaceContentEntry(pdfDoc, page, entry, newText) {
    const newStream = pdfDoc.context.flateStream(newText);

    if (entry.ref) {
      pdfDoc.context.assign(entry.ref, newStream);
      return;
    }

    if (entry.array && Number.isInteger(entry.arrayIndex)) {
      entry.array.set(entry.arrayIndex, newStream);
      return;
    }

    page.node.set(entry.contentsKey, newStream);
  }

  async function scanPdf(bytes, remove = false, progressPrefix = 'Analyzing') {
    const pdfDoc = await PDFDocument.load(new Uint8Array(bytes), {
      updateMetadata: false,
      ignoreEncryption: false,
    });

    const pages = pdfDoc.getPages();
    const pageResults = [];
    const totalBrandCounts = {};
    let totalHits = 0;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      setProgress(`${progressPrefix} page ${pageIndex + 1} of ${pages.length}…`, pageIndex, pages.length);
      const page = pages[pageIndex];
      const entries = getPageContentEntries(pdfDoc, page);
      let pageHits = 0;
      const pageBrandCounts = {};

      for (const entry of entries) {
        let text;
        try {
          text = decodeStream(entry.stream);
        } catch (error) {
          console.warn(`Could not decode a content stream on page ${pageIndex + 1}`, error);
          continue;
        }

        const inspected = inspectAndOptionallyCleanContent(text, remove);
        pageHits += inspected.hits;
        mergeCounts(pageBrandCounts, inspected.brandCounts);
        mergeCounts(totalBrandCounts, inspected.brandCounts);
        if (remove && inspected.modified) replaceContentEntry(pdfDoc, page, entry, inspected.text);
      }

      totalHits += pageHits;
      pageResults.push({ page: pageIndex + 1, hits: pageHits, brandCounts: pageBrandCounts });

      if (pageIndex > 0 && pageIndex % 8 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    setProgress(remove ? 'Saving cleaned PDF…' : 'Analysis complete', pages.length, pages.length);

    if (!remove) {
      return {
        pageCount: pages.length,
        totalHits,
        pages: pageResults,
        brandCounts: totalBrandCounts,
      };
    }

    const out = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 50,
    });

    return {
      pageCount: pages.length,
      totalHits,
      pages: pageResults,
      brandCounts: totalBrandCounts,
      bytes: out,
    };
  }

  function setProgress(label, done, total) {
    els.progressWrap.classList.remove('hidden');
    els.progressLabel.textContent = label;
    const percent = total ? Math.round((done / total) * 100) : 0;
    els.progressPercent.textContent = `${percent}%`;
    els.progressBar.style.width = `${percent}%`;
  }

  function hideProgress() {
    els.progressWrap.classList.add('hidden');
  }

  function setStatus(text, state) {
    els.status.textContent = text;
    els.status.className = `status-pill ${state}`;
  }

  function setBusy(value) {
    busy = value;
    els.browse.disabled = value;
    els.reset.disabled = value;
  }

  function clearMessages() {
    els.error.classList.add('hidden');
    els.error.textContent = '';
    els.result.classList.add('hidden');
    els.download.disabled = true;
    els.resultText.textContent = '';
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.classList.remove('hidden');
  }

  function normalizeError(error) {
    const message = String(error?.message || error || 'Unknown error');
    if (/encrypted|password/i.test(message)) return 'This PDF is password-protected or encrypted. Please use an unlocked PDF.';
    if (/Invalid PDF|Missing PDF|header/i.test(message)) return 'The selected file could not be read as a valid PDF.';
    return `Could not process this PDF: ${message}`;
  }

  function brandLabelFromId(id) {
    return CONFIG.targets.find((target) => target.id === id)?.label || id;
  }

  function describeBrandCounts(counts) {
    const entries = Object.entries(counts || {}).filter(([, value]) => value > 0);
    if (!entries.length) return 'No configured owned-brand watermark text was detected.';
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `<strong>${escapeHtml(brandLabelFromId(id))}</strong>: ${count}`)
      .join(' &nbsp;•&nbsp; ');
  }

  function describePageBrands(counts) {
    const labels = Object.entries(counts || {})
      .filter(([, value]) => value > 0)
      .map(([id]) => brandLabelFromId(id));
    return labels.length ? labels.join(', ') : '';
  }

  function renderSummary(result, outputBytes) {
    const affected = result.pages.filter((page) => page.hits > 0).length;
    els.empty.classList.add('hidden');
    els.summary.classList.remove('hidden');
    els.pageList.classList.remove('hidden');
    els.brandSummary.classList.remove('hidden');

    els.statPages.textContent = result.pageCount;
    els.statAffected.textContent = affected;
    els.statHits.textContent = result.totalHits;
    els.statSize.textContent = fmtBytes(outputBytes?.byteLength || selectedFile?.size || 0);
    els.brandSummary.innerHTML = `<strong>Detected configured brands:</strong> ${describeBrandCounts(result.brandCounts)}`;

    els.pageList.innerHTML = result.pages.map((page) => {
      const brands = describePageBrands(page.brandCounts);
      return `
        <div class="page-row">
          <strong>Page ${page.page}</strong>
          <span class="badge ${page.hits ? 'hit' : 'clear'}">${page.hits ? 'REMOVED' : 'CLEAR'}</span>
          <span class="page-note">${page.hits ? `${page.hits} matched watermark item${page.hits === 1 ? '' : 's'}${brands ? ` · ${escapeHtml(brands)}` : ''}` : 'No configured text watermark match'}</span>
        </div>
      `;
    }).join('');
  }

  function clearOutputUrl() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }

  function prepareDownload(bytes) {
    clearOutputUrl();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    outputUrl = URL.createObjectURL(blob);
    els.download.disabled = false;
    els.resultText.textContent = `${selectedFile.name} · ${fmtBytes(blob.size)}`;
    els.result.classList.remove('hidden');
  }

  function downloadPreparedPdf() {
    if (!outputUrl || !selectedFile) return;
    const anchor = document.createElement('a');
    anchor.href = outputUrl;
    anchor.download = selectedFile.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function processFile(file) {
    if (!file || busy) return;

    clearMessages();
    clearOutputUrl();
    cleanedBytes = null;
    els.summary.classList.add('hidden');
    els.brandSummary.classList.add('hidden');
    els.pageList.classList.add('hidden');
    els.pageList.innerHTML = '';
    els.empty.classList.remove('hidden');

    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError('Please select a PDF file.');
      return;
    }
    if (file.size > CONFIG.maxFileBytes) {
      showError(`Please use a PDF smaller than ${fmtBytes(CONFIG.maxFileBytes)}. This file is ${fmtBytes(file.size)}.`);
      return;
    }

    selectedFile = file;
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    els.fileMeta.textContent = `${file.name} · ${fmtBytes(file.size)}`;
    els.fileMeta.classList.remove('hidden');

    setBusy(true);
    setStatus('Analyzing…', 'scanning');
    els.empty.classList.add('hidden');

    try {
      const analysis = await scanPdf(sourceBytes, false, 'Analyzing');

      if (analysis.totalHits === 0) {
        renderSummary(analysis, sourceBytes);
        setStatus('No configured watermark text found', 'clean');
        els.resultText.textContent = 'No configured text watermark was detected, so this PDF was left unchanged.';
        els.result.classList.remove('hidden');
        els.download.disabled = true;
        return;
      }

      setStatus('Removing matched watermark…', 'scanning');
      const cleaned = await scanPdf(sourceBytes, true, 'Removing watermark from');

      setStatus('Verifying…', 'scanning');
      const verification = await scanPdf(cleaned.bytes, false, 'Verifying');
      if (verification.totalHits !== 0) {
        throw new Error(`Verification found ${verification.totalHits} configured watermark item(s) still present. Download was blocked to avoid returning a partially cleaned PDF.`);
      }

      cleanedBytes = cleaned.bytes;
      renderSummary(analysis, cleanedBytes);
      prepareDownload(cleanedBytes);
      setStatus('Ready to download', 'clean');
    } catch (error) {
      console.error(error);
      setStatus('Processing failed', 'idle');
      showError(normalizeError(error));
    } finally {
      hideProgress();
      setBusy(false);
    }
  }

  function resetAll() {
    if (busy) return;
    selectedFile = null;
    sourceBytes = null;
    cleanedBytes = null;
    els.file.value = '';
    els.fileMeta.textContent = '';
    els.fileMeta.classList.add('hidden');
    els.summary.classList.add('hidden');
    els.brandSummary.classList.add('hidden');
    els.pageList.classList.add('hidden');
    els.pageList.innerHTML = '';
    els.empty.classList.remove('hidden');
    hideProgress();
    clearMessages();
    clearOutputUrl();
    setStatus('Waiting for PDF', 'idle');
  }

  els.file.addEventListener('change', () => processFile(els.file.files?.[0]));
  els.browse.addEventListener('click', (event) => {
    event.preventDefault();
    if (!busy) els.file.click();
  });
  els.download.addEventListener('click', downloadPreparedPdf);
  els.reset.addEventListener('click', resetAll);

  ['dragenter', 'dragover'].forEach((eventName) => {
    els.drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!busy) els.drop.classList.add('drag');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    els.drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.drop.classList.remove('drag');
    });
  });

  els.drop.addEventListener('drop', (event) => {
    if (!busy) processFile(event.dataTransfer?.files?.[0]);
  });

  resetAll();
})();
