/* ═══════════════════════════════════════════════════════
   CVForge Pro — Production App v4
   Optimizations:
   • Tuned temperatures per task (0.3 structured, 0.6 creative)
   • All system prompts hardened & specific
   • PDF renders Resume.pdf layout (not <pre> monospace)
   • ATS score prompt structured — no hallucination
   • Keyword extraction enforces min 15, max 35 items
   • Bullet enhancer enforces exact verb list
   • buildCVPrompt fully structured with explicit sections
   • safeStr used everywhere; no dead code
   ═══════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ─────────── CONSTANTS ─────────── */
  const STORAGE_KEY = "cvforge_pro_data_v2";
  const GROQ_MODEL = "llama-3.3-70b-versatile";
  const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

  /* ─────────── SYSTEM PROMPTS ───────────
     Each prompt is task-specific with explicit
     output format, constraints, and examples.
     Temperature is set per-call:
       0.2 → JSON/structured output (ATS score, keywords, skills)
       0.5 → CV generation (consistent but not robotic)
       0.4 → Summary (punchy but controlled)
       0.3 → Bullet enhancement (verb-first, disciplined)
       0.5 → Polish (improve without over-creative rewrite)
  ────────────────────────────────────────── */

  /* Master CV writer — used for CV generation and polish */
  const SYS_CV_WRITER = `You are a professional CV writer. Your job is to format and present the candidate's data as a clean, ATS-optimised CV.

CRITICAL ANTI-HALLUCINATION RULES — these override everything else:
✗ NEVER invent, fabricate, or assume ANY information not explicitly provided by the candidate
✗ NEVER add fake company names, job titles, dates, metrics, tools, or responsibilities
✗ NEVER fill "Not provided" sections with invented content — OMIT those sections entirely
✗ NEVER improve a metric the candidate did not provide — do not change "improved X" to "improved X by 40%"
✗ NEVER add quantified results unless the candidate gave you specific numbers
✗ NEVER use placeholder text like [Company Name], [Year], [Number] — if data is missing, omit that line
✗ If a section has no data, skip it completely — do not write the section header either
✗ If responsibilities are vague, rephrase them with stronger verbs but DO NOT add invented outcomes

OUTPUT FORMAT — follow EXACTLY:

1. CONTACT BLOCK (top):
   Full Name
   Phone | Email | Location | LinkedIn | GitHub
   (Only include contact items the candidate actually provided)

2. SECTION HEADERS: ALL CAPS. No #, *, -, or markdown.

3. EXPERIENCE ENTRIES:
   Job Title | Company Name
   Date Range | Employment Type | Location
   • Bullet (action verb + ONLY data the candidate provided)
   (Blank line between entries)

4. SKILLS: Category label: value1, value2, value3
   (Only include categories with actual data)

5. PROJECTS:
   Project Name
   • Description using only provided details

6. EDUCATION:
   Degree | Institution
   Year Range

7. CERTIFICATIONS: • Name – Issuer (Year)

STYLE RULES:
✓ Every bullet starts with a past-tense action verb
✓ Rephrase weak language into professional CV language — but only using the candidate's own facts
✓ Remove clichés (results-driven, passionate, hardworking, go-getter)
✓ No first-person pronouns
✓ Consistent date format throughout
✓ Plain text only — no markdown symbols

SINGLE-PAGE RULE:
• Max 450 words total
• Summary: max 3 sentences, 50 words
• Each job: max 3 bullets, max 18 words per bullet
• Skills: inline comma-separated per category
• Trim to highest-impact content if it exceeds one page`;

  /* ATS scorer — strict JSON output */
  const SYS_ATS_SCORER = `You are an enterprise ATS (Applicant Tracking System) simulation engine. You score CVs exactly as Workday, Taleo, and Greenhouse do. You are precise, objective, and consistent.

You MUST return a valid JSON object and nothing else — no preamble, no explanation, no markdown fences.

Scoring criteria:
- Keywords: exact string matches from job description (case-insensitive)
- Format: no tables/columns, parseable sections, standard headers
- Verbs: bullet points starting with action verbs
- Metrics: quantified results (%, numbers, currency, time)
- Contact: name, email, phone, location all present
- Sections: standard sections present (summary, experience, skills, education)

JSON schema (return EXACTLY this structure):
{
  "score": <integer 0-100>,
  "grade": "<A|B|C|D|F>",
  "checks": [
    {"label": "Keywords matched", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "Action verbs on bullets", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "Quantified metrics", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "ATS-parseable format", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "Contact info complete", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "Relevant experience present", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "Skills section complete", "pass": <bool>, "detail": "<specific finding>"},
    {"label": "Education present", "pass": <bool>, "detail": "<specific finding>"}
  ],
  "found_keywords": ["<exact string>", ...],
  "missing_keywords": ["<exact string>", ...]
}`;

  /* Keyword extractor — strict JSON array */
  const SYS_KEYWORD_EXTRACTOR = `You are a specialist ATS keyword analyst. Your job is to extract the exact keyword phrases that ATS systems use for candidate matching.

Rules:
- Extract 15 to 35 keywords maximum
- Use VERBATIM phrases from the job description — never paraphrase
- Include: specific technologies, tools, frameworks, methodologies, qualifications, certifications, industry terms
- Exclude: generic words (team, work, good, strong), company names, soft skills unless explicitly listed as requirements
- Prioritize: required skills over preferred; specific tools over general categories
- Return a JSON array of strings ONLY — no other text, no markdown

Example output: ["React.js", "Node.js", "PostgreSQL", "REST API design", "Agile methodology", "AWS Lambda"]`;

  /* Skills extractor */
  const SYS_SKILL_EXTRACTOR = `You extract technical skills from job descriptions into a structured JSON object. You are precise — you use verbatim names, never paraphrase technology names.

Rules:
- "tech" = programming languages, frameworks, libraries, APIs
- "tool" = software tools, platforms, cloud services, SaaS products
- "meth" = methodologies, processes, practices, concepts
- Use EXACT names as written in the JD ("Node.js" not "Node", "PostgreSQL" not "Postgres")
- Return ONLY valid JSON matching this schema: {"tech": [...], "tool": [...], "meth": [...]}
- No markdown, no explanation, no other text`;

  /* Summary writer */
  const SYS_SUMMARY_WRITER = `You are a professional CV summary writer. Write a summary using ONLY the information the candidate has provided.

ANTI-HALLUCINATION RULES:
✗ Never invent experience, skills, tools, or achievements not mentioned by the candidate
✗ Never add metrics or numbers the candidate did not provide
✗ If the candidate has 0 years of experience, write a fresher-appropriate summary — do not invent experience
✗ Only embed keywords from the job description that genuinely match the candidate's actual background

FORMAT:
- 3 sentences max, 50–80 words total
- Sentence 1: years of experience (or "fresher") + role title + specialisation (from provided data only)
- Sentence 2: top tools/skills the candidate actually listed
- Sentence 3: strongest achievement the candidate actually described, or career goal if fresher
- NO first-person pronouns, NO clichés, NO filler phrases
- Return ONLY the summary text — no labels, no quotes`;

  /* Bullet enhancer */
  const SYS_BULLET_ENHANCER = `You are a CV bullet point editor. Your job is to rephrase the candidate's own responsibilities and achievements into professional CV language.

ANTI-HALLUCINATION RULES — strictly enforced:
✗ NEVER add metrics, numbers, or percentages the candidate did not provide
✗ NEVER invent tools, technologies, team sizes, or outcomes not mentioned
✗ If no metric is given, write a strong action-verb bullet WITHOUT a fabricated number
✗ "Managed customer queries" → "Managed customer queries and resolved escalations efficiently" ✓
✗ "Managed customer queries" → "Managed 500+ daily customer queries, achieving 98% satisfaction" ✗ (invented)

ALLOWED enhancements:
✓ Replace weak verbs with strong ones: Architected, Automated, Built, Configured, Delivered, Deployed, Designed, Developed, Directed, Engineered, Enhanced, Implemented, Integrated, Launched, Led, Maintained, Managed, Optimized, Orchestrated, Reduced, Resolved, Scaled, Streamlined, Supervised, Trained
✓ Reorder for impact (result before method is fine)
✓ Remove filler words and tighten phrasing
✓ Use exact technology names the candidate mentioned

FORMAT:
- Every bullet starts with a past-tense action verb
- Max 20 words per bullet
- Prefix with • (U+2022)
- Return two labeled sections:
  RESPONSIBILITIES:
  [bullets]
  ACHIEVEMENTS:
  [bullets]
- No markdown, no explanation`;

  /* Polish system prompt */
  const SYS_POLISH = `You are a CV editor performing final quality review. Improve the CV's language without changing any facts.

ANTI-HALLUCINATION RULES:
✗ Do NOT add any metrics or numbers that aren't already in the CV
✗ Do NOT add tools, skills, or experience not already present
✗ Do NOT "improve vague metrics" by inventing specific numbers
✗ Do NOT change company names, dates, or qualifications

WHAT YOU CAN FIX:
✓ Replace weak action verbs with stronger ones (from the candidate's own bullets)
✓ Tighten wordy sentences — remove redundant words
✓ Ensure ALL section headers are ALL CAPS
✓ Ensure every bullet starts with a past-tense action verb
✓ Fix inconsistent date formats
✓ Remove clichés and generic filler phrases
✓ Ensure clean single blank line between sections
✓ Embed JD keywords ONLY where they genuinely match existing content

Return the COMPLETE improved CV as plain text only — no markdown, no labels, no explanation.`;

  /* ─────────── STATE ─────────── */
  const data = {
    experiences: [],
    projects: [],
    education: [],
    certifications: [],
    skills: { tech: [], tool: [], meth: [], soft: [], lang: [] },
    keywords: [],
  };
  let currentPanel = 0,
    modalType = "",
    modalEditIdx = -1;
  let cvGenerated = false,
    editMode = false,
    cvBackup = "";
  let toastTimer = null;

  const FIELD_IDS = [
    "targetRole", "industry", "expLevel", "country", "cvFormat", "jobDescription",
    "targetCompanies", "jobLocPref", "visaStatus", "relocate",
    "fullName", "proTitle", "email", "phone", "location", "linkedin", "github", "portfolio",
    "yearsExp", "specialization", "topSkills", "achievements", "summary",
    "awards", "volunteer", "memberships",
    "careerGaps", "salaryExp", "remoteHybrid",
  ];

  const SKILL_MAP = {
    tech: { input: "techInput", tags: "techTags" },
    tool: { input: "toolInput", tags: "toolTags" },
    meth: { input: "methInput", tags: "methTags" },
    soft: { input: "softInput", tags: "softTags" },
    lang: { input: "langInput", tags: "langTags" },
  };

  /* ─────────── HELPERS ─────────── */
  const $ = (id) => document.getElementById(id);

  function g(id) {
    const el = $(id);
    return el ? (el.value || "").trim() : "";
  }

  function safeStr(v) {
    return (v == null ? "" : String(v)).trim();
  }

  function escapeHtml(str) {
    return safeStr(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(str) {
    return safeStr(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function extractJSON(raw) {
    const clean = safeStr(raw).replace(/```json|```/gi, "");
    try {
      return JSON.parse(clean);
    } catch (_) {}
    const m = clean.match(/(\{[\s\S]*?\}|\[[\s\S]*?\])/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch (_) {}
    }
    /* Last resort: find largest JSON block */
    const m2 = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m2) {
      try {
        return JSON.parse(m2[1]);
      } catch (_) {}
    }
    return null;
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function showToast(msg, type = "", dur = 3000) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast show" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), dur);
  }

  function setBtnLoading(id, loading, label) {
    const b = $(id);
    if (!b) return;
    b.disabled = loading;
    if (loading) b.innerHTML = '<span class="spinning">⟳</span> Working…';
    else if (label !== undefined) b.innerHTML = label;
  }

  function showDraft() {
    const d = $("draftIndicator");
    if (!d) return;
    d.classList.add("show");
    clearTimeout(d._t);
    d._t = setTimeout(() => d.classList.remove("show"), 2000);
  }

  /* ─────────── PERSISTENCE ─────────── */
  function saveAllData() {
    try {
      const snap = {
        fields: {},
        data: {
          experiences: data.experiences,
          projects: data.projects,
          education: data.education,
          certifications: data.certifications,
          skills: data.skills,
          keywords: data.keywords,
        },
        cvGenerated,
        currentPanel,
        cvText: $("cvOutput")?.textContent || "",
      };
      FIELD_IDS.forEach((id) => {
        const el = $(id);
        if (el) snap.fields[id] = el.value;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      showDraft();
    } catch (e) {
      console.warn("Save failed:", e);
    }
  }

  function loadAllData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (snap.fields) {
        Object.entries(snap.fields).forEach(([id, val]) => {
          const el = $(id);
          if (el) el.value = val;
        });
      }
      if (snap.data) {
        const d = snap.data;
        if (Array.isArray(d.experiences)) data.experiences = d.experiences;
        if (Array.isArray(d.projects)) data.projects = d.projects;
        if (Array.isArray(d.education)) data.education = d.education;
        if (Array.isArray(d.certifications))
          data.certifications = d.certifications;
        if (d.skills) {
          ["tech", "tool", "meth", "soft", "lang"].forEach((k) => {
            if (Array.isArray(d.skills[k])) data.skills[k] = d.skills[k];
          });
        }
        if (Array.isArray(d.keywords)) data.keywords = d.keywords;
      }
      if (snap.cvText) {
        const cvOut = $("cvOutput");
        if (cvOut) {
          cvOut.textContent = snap.cvText;
          cvOut.style.display = "block";
          $("cvEmptyState").style.display = "none";
          $("cvToolbar").style.display = "flex";
          const ec = $("exportCard");
          if (ec) ec.style.display = "block";
          $("editBtn").style.display = "inline-flex";
          $("polishBtn").style.display = "inline-flex";
        }
      }
      cvGenerated = !!snap.cvGenerated;
      ["exp", "proj", "edu", "cert"].forEach(renderList);
      Object.keys(SKILL_MAP).forEach(renderTags);
      if (data.keywords.length) {
        $("kwGrid").innerHTML = data.keywords
          .map((k) => `<span class="kw kw-found">${escapeHtml(k)}</span>`)
          .join("");
        $("kwResult").style.display = "block";
        $("kwAlert").className = "alert a-success show";
        $("kwAlert").textContent =
          `✓ ${data.keywords.length} ATS keywords loaded.`;
      }
    } catch (e) {
      console.warn("Load failed:", e);
    }
  }

  const debouncedSave = debounce(saveAllData, 800);

  /* ── CLEAR FUNCTIONS ──────────────────────────────────────
     clearSection(n) — wipes only that panel's data in-place.
     clearAllData()  — resets entire app without page reload,
     avoiding the beforeunload confirm dialog trap.
  ─────────────────────────────────────────────────────────── */
  let _suppressUnload = false;

  const PANEL_FIELDS = {
    0: ["targetRole","industry","country","jobDescription","targetCompanies","jobLocPref","visaStatus","relocate"],
    1: ["fullName","proTitle","email","phone","location","linkedin","github","portfolio"],
    2: ["yearsExp","specialization","topSkills","achievements","summary"],
    3: [],
    4: [],
    5: [],
    6: [],
    7: ["awards","volunteer","memberships","careerGaps","salaryExp","remoteHybrid"],
    8: [],
  };

  function _resetUI() {
    const hide = (id) => {
      const e = $(id);
      if (e) e.style.display = "none";
    };
    const show = (id, d) => {
      const e = $(id);
      if (e) e.style.display = d || "flex";
    };
    const setText = (id, cls, txt) => {
      const e = $(id);
      if (e) {
        e.className = cls;
        e.textContent = txt;
      }
    };

    hide("cvToolbar");
    hide("exportCard");
    hide("scoreCard");
    hide("kwGapCard");
    hide("editBtn");
    hide("polishBtn");
    hide("expPdfMob");
    hide("topScorePill");
    show("cvEmptyState", "flex");
    hide("cvOutput");

    const cvOut = $("cvOutput");
    if (cvOut) {
      cvOut.textContent = "";
      cvOut.contentEditable = "false";
    }
    const genErr = $("genErr");
    if (genErr) genErr.className = "alert a-err";
    const kwGrid = $("kwGrid");
    if (kwGrid) kwGrid.innerHTML = "";
    const kwResult = $("kwResult");
    if (kwResult) kwResult.style.display = "none";
    setText(
      "kwAlert",
      "alert a-info show",
      '\u{1F4A1} Paste a job description and click "Extract Keywords".',
    );
    setText(
      "sumAlert",
      "alert a-info show",
      'Fill in the background above, then click "Write with Groq".',
    );
    const editModeBar = $("editModeBar");
    if (editModeBar) editModeBar.classList.remove("show");
    const editBadge = $("editBadge");
    if (editBadge) editBadge.style.display = "none";
    cvGenerated = false;
    editMode = false;
    cvBackup = "";
  }

  function clearSection(panelIdx) {
    if (!confirm("Clear this section? Cannot be undone.")) return;
    (PANEL_FIELDS[panelIdx] || []).forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (el.tagName === "SELECT") el.selectedIndex = 0;
      else el.value = "";
    });
    if (panelIdx === 0) {
      data.keywords = [];
      const kwGrid = $("kwGrid");
      if (kwGrid) kwGrid.innerHTML = "";
      const kwResult = $("kwResult");
      if (kwResult) kwResult.style.display = "none";
      const kwAlert = $("kwAlert");
      if (kwAlert) {
        kwAlert.className = "alert a-info show";
        kwAlert.textContent =
          '\u{1F4A1} Paste a job description and click "Extract Keywords".';
      }
    }
    if (panelIdx === 2) {
      const al = $("sumAlert");
      if (al) {
        al.className = "alert a-info show";
        al.textContent =
          'Fill in background above, then click "Write with Groq".';
      }
    }
    if (panelIdx === 3) {
      data.experiences = [];
      renderList("exp");
    }
    if (panelIdx === 4) {
      Object.keys(data.skills).forEach((k) => {
        data.skills[k] = [];
      });
      Object.keys(SKILL_MAP).forEach(renderTags);
    }
    if (panelIdx === 5) {
      data.projects = [];
      renderList("proj");
    }
    if (panelIdx === 6) {
      data.education = [];
      renderList("edu");
    }
    if (panelIdx === 7) {
      data.certifications = [];
      renderList("cert");
    }
    updateProgress();
    saveAllData();
    showToast("\u2713 Section cleared", "success");
  }

  function clearAllData() {
    if (
      !confirm("Clear ALL your CV data and start fresh? This cannot be undone.")
    )
      return;
    _suppressUnload = true;
    data.experiences = [];
    data.projects = [];
    data.education = [];
    data.certifications = [];
    data.keywords = [];
    Object.keys(data.skills).forEach((k) => {
      data.skills[k] = [];
    });
    localStorage.removeItem(STORAGE_KEY);
    FIELD_IDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (el.tagName === "SELECT") el.selectedIndex = 0;
      else el.value = "";
    });
    ["exp", "proj", "edu", "cert"].forEach((t) => {
      const el = $(t + "List");
      if (el) el.innerHTML = "";
    });
    Object.keys(SKILL_MAP).forEach(renderTags);
    _resetUI();
    goTo(0);
    updateProgress();
    setTimeout(() => {
      _suppressUnload = false;
    }, 500);
    showToast("\u2713 All data cleared \u2014 starting fresh", "success");
  }

  /* ─────────── GROQ KEY ─────────── */
  function getKey() {
    return localStorage.getItem("cvforge_groq_key") || "";
  }

  function updateKeyUI() {
    const k = getKey();
    const btn = $("apiKeyBtn"),
      st = $("apiKeyStatus");
    if (!btn || !st) return;
    if (k) {
      st.textContent = "Key Active ✓";
      btn.style.borderColor = "rgba(34,211,160,.35)";
      btn.style.color = "var(--green)";
    } else {
      st.textContent = "Set Groq Key";
      btn.style.borderColor = "";
      btn.style.color = "";
    }
  }

  function openApiKeyModal() {
    const ov = $("apiKeyOverlay");
    if (!ov) return;
    ov.classList.add("open");
    const inp = $("groqKeyInput");
    if (inp) {
      inp.value = getKey() || "";
      inp.focus();
    }
    const err = $("apiKeyErr");
    if (err) err.className = "alert a-err";
  }

  function closeApiKeyModal() {
    $("apiKeyOverlay")?.classList.remove("open");
  }

  function saveApiKey() {
    const inp = $("groqKeyInput"),
      err = $("apiKeyErr");
    if (!inp) return;
    const k = inp.value.trim();
    if (!k || !k.startsWith("gsk_")) {
      if (err) {
        err.className = "alert a-err show";
        err.textContent =
          "Key must start with gsk_ — copy exactly from console.groq.com";
      }
      return;
    }
    localStorage.setItem("cvforge_groq_key", k);
    closeApiKeyModal();
    updateKeyUI();
    showToast("✓ Groq API key saved!", "success");
  }

  /* ─────────── GROQ API ─────────── */
  async function callGroq(
    userPrompt,
    systemPrompt,
    maxTokens = 4096,
    temperature = 0.5,
  ) {
    const key = getKey();
    if (!key) {
      openApiKeyModal();
      throw new Error("Set your Groq API key first");
    }
    const msgs = [];
    if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
    msgs.push({ role: "user", content: userPrompt });
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: msgs,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) {
      let msg = "Groq API error " + res.status;
      try {
        const j = await res.json();
        msg = j?.error?.message || msg;
      } catch (_) {}
      if (res.status === 401)
        msg = "Invalid Groq API key — re-enter at console.groq.com";
      if (res.status === 429)
        msg = "Rate limit — wait 30 seconds and try again";
      throw new Error(msg);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
  }

  /* ─────────── NAVIGATION ─────────── */
  function goTo(n) {
    if (n < 0 || n > 8) return;
    document
      .querySelectorAll(".panel")
      .forEach((p, i) => p.classList.toggle("active", i === n));
    document
      .querySelectorAll(".sitem")
      .forEach((s, i) => s.classList.toggle("active", i === n));
    document
      .querySelectorAll(".mnav-item")
      .forEach((m, i) => m.classList.toggle("active", i === n));
    currentPanel = n;
    window.scrollTo({ top: 0, behavior: "smooth" });
    updateProgress();
    saveAllData();
  }

  /* ─────────── PROGRESS ─────────── */
  function updateProgress() {
    const checks = [
      () => g("targetRole") && g("industry"),
      () => g("fullName") && g("email"),
      () => g("summary"),
      () => data.experiences.length > 0,
      () => data.skills.tech.length > 0 || data.skills.tool.length > 0,
      () => data.projects.length > 0,
      () => data.education.length > 0,
      () => data.certifications.length > 0,
      () => cvGenerated,
    ];
    let done = 0;
    checks.forEach((fn, i) => {
      const ok = fn();
      $("sitem" + i)?.classList.toggle("done", ok);
      $("mn" + i)?.classList.toggle("done", ok);
      if (ok) done++;
    });
    const pct = Math.round((done / 8) * 100);
    const pctEl = $("sbPct"),
      barEl = $("sbBar");
    if (pctEl) pctEl.textContent = pct + "%";
    if (barEl) barEl.style.width = pct + "%";
  }

  /* ═══════════════════════════════════════
     AI FEATURES — all with tuned temperatures
  ═══════════════════════════════════════ */

  /* ── Extract Keywords (temp 0.2 — exact extraction) ── */
  async function aiExtractKeywords() {
    const jd = g("jobDescription");
    if (!jd) {
      showToast("Paste a job description first");
      return;
    }
    setBtnLoading("kwBtn", true);
    try {
      const res = await callGroq(
        `Job description to extract keywords from:\n\n${jd.slice(0, 4500)}`,
        SYS_KEYWORD_EXTRACTOR,
        1024,
        0.2 /* low temp = precise extraction, no creative variation */,
      );
      const kws = extractJSON(res);
      const arr = Array.isArray(kws)
        ? kws.filter((k) => typeof k === "string" && k.trim())
        : [];
      if (!arr.length) {
        showToast("No keywords parsed — try again", "error");
        return;
      }
      data.keywords = arr;
      $("kwGrid").innerHTML = arr
        .map((k) => `<span class="kw kw-found">${escapeHtml(k)}</span>`)
        .join("");
      $("kwResult").style.display = "block";
      $("kwAlert").className = "alert a-success show";
      $("kwAlert").textContent = `✓ ${arr.length} ATS keywords extracted`;
      showToast(`✓ ${arr.length} keywords extracted`, "success");
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("kwBtn", false, "✦ Extract Keywords");
  }

  /* ── Generate Summary (temp 0.4 — controlled creativity) ── */
  async function aiSummary() {
    const role = g("targetRole"),
      yrs = g("yearsExp"),
      spec = g("specialization");
    const skills = g("topSkills"),
      ach = g("achievements"),
      jd = g("jobDescription");
    setBtnLoading("aiSumBtn", true);
    const al = $("sumAlert");
    if (al) {
      al.className = "alert a-info show";
      al.textContent = "⟳ Groq is writing your summary…";
    }
    try {
      const userPrompt = [
        `Target Role: ${role || "Not specified"}`,
        `Years of Experience: ${yrs || "Not specified"}`,
        `Specialization: ${spec || "Not specified"}`,
        `Key Technologies/Skills: ${skills || "Not specified"}`,
        `Key Achievements: ${ach || "Not specified"}`,
        jd
          ? `\nJob Description (extract keywords to embed):\n${jd.slice(0, 2000)}`
          : "",
      ].join("\n");
      const res = await callGroq(userPrompt, SYS_SUMMARY_WRITER, 512, 0.4);
      const summaryEl = $("summary");
      if (summaryEl) summaryEl.value = res.trim();
      if (al) {
        al.className = "alert a-success show";
        al.textContent = "✓ Summary generated — review and personalise.";
      }
      updateProgress();
      showToast("✓ Summary generated", "success");
      saveAllData();
    } catch (e) {
      if (al) {
        al.className = "alert a-err show";
        al.textContent = "Error: " + e.message;
      }
      showToast(e.message, "error");
    }
    setBtnLoading("aiSumBtn", false, "✦ Generate with Groq");
  }

  /* ── Extract Skills from JD (temp 0.2 — JSON output) ── */
  async function aiExtractSkills() {
    const jd = g("jobDescription");
    if (!jd) {
      showToast("Go to Panel 1 and paste a job description first");
      return;
    }
    setBtnLoading("aiSkillBtn", true);
    try {
      const res = await callGroq(
        `Job description:\n\n${jd.slice(0, 4500)}`,
        SYS_SKILL_EXTRACTOR,
        1024,
        0.2 /* must be exact — no variation */,
      );
      const parsed = extractJSON(res);
      if (!parsed || typeof parsed !== "object") {
        showToast("Could not parse skills — try again", "error");
        return;
      }
      let added = 0;
      ["tech", "tool", "meth"].forEach((type) => {
        if (Array.isArray(parsed[type])) {
          parsed[type].forEach((s) => {
            const clean = safeStr(s);
            if (clean && !data.skills[type].includes(clean)) {
              data.skills[type].push(clean);
              added++;
            }
          });
          renderTags(type);
        }
      });
      showToast(`✓ ${added} skills extracted`, "success");
      updateProgress();
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("aiSkillBtn", false, "✦ Extract from Job Description");
  }

  /* ── Enhance Bullets (temp 0.3 — disciplined verb-first) ── */
  async function aiEnhanceBullets(respId, achievId, btnEl) {
    const resp = safeStr($(respId)?.value);
    const achiev = safeStr($(achievId)?.value);
    const role = g("targetRole");
    const techVal = safeStr($("mf_tech")?.value);
    if (!resp && !achiev) {
      showToast("Enter responsibilities or achievements first");
      return;
    }
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<span class="spinning">⟳</span> Enhancing…';
    }
    try {
      const userPrompt = [
        `Target Role: ${role || "Not specified"}`,
        `Technologies Used: ${techVal || "Not specified"}`,
        "",
        "RESPONSIBILITIES:",
        resp || "None provided",
        "",
        "ACHIEVEMENTS:",
        achiev || "None provided",
      ].join("\n");
      const res = await callGroq(userPrompt, SYS_BULLET_ENHANCER, 1024, 0.3);
      const parts = res.split(/\n\s*ACHIEVEMENTS\s*:/i);
      if ($(respId))
        $(respId).value = safeStr(parts[0])
          .replace(/^RESPONSIBILITIES\s*:/i, "")
          .trim();
      if ($(achievId)) $(achievId).value = parts[1] ? safeStr(parts[1]) : "";
      showToast("✓ Bullets enhanced", "success");
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = "✦ AI Enhance Bullets";
    }
  }

  /* ── AI Polish (temp 0.5) ── */
  async function aiPolishCV() {
    const out = $("cvOutput");
    const currentCV = safeStr(out?.textContent);
    if (!currentCV) {
      showToast("Generate CV first");
      return;
    }
    setBtnLoading("polishBtn", true);
    const jd = g("jobDescription");
    try {
      const userPrompt = [
        jd
          ? `JOB DESCRIPTION KEYWORDS TO EMBED:\n${jd.slice(0, 2000)}\n\n`
          : "",
        "CV TO IMPROVE:\n" + currentCV,
      ].join("");
      const improved = await callGroq(userPrompt, SYS_POLISH, 4096, 0.5);
      cvBackup = out.textContent;
      out.textContent = improved.trim();
      showToast("✓ CV polished", "success");
      await runATSScore(improved);
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("polishBtn", false, "✦ AI Polish");
  }

  /* ═══════════════════════════════════════
     GENERATE CV
  ═══════════════════════════════════════ */
  async function generateCV() {
    const role = g("targetRole");
    if (!role) {
      goTo(0);
      showToast("Enter your target job title first");
      return;
    }
    if (!getKey()) {
      openApiKeyModal();
      return;
    }

    const cvOut = $("cvOutput"),
      emptyState = $("cvEmptyState");
    const toolbar = $("cvToolbar"),
      expCard = $("exportCard");
    const aiBar = $("aiStatusBar"),
      errEl = $("genErr");

    emptyState.style.display = "none";
    cvOut.style.display = "none";
    toolbar.style.display = "none";
    if (expCard) expCard.style.display = "none";
    aiBar.style.display = "flex";
    errEl.className = "alert a-err";
    ["genBtn", "genBtn2"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = true;
    });
    ["scoreCard", "kwGapCard"].forEach((id) => {
      const el = $(id);
      if (el) el.style.display = "none";
    });
    ["editBtn", "polishBtn"].forEach((id) => {
      const el = $(id);
      if (el) el.style.display = "none";
    });
    const badge = $("editBadge");
    if (badge) badge.style.display = "none";

    const statuses = [
      "Reading job description keywords…",
      "Structuring CV sections…",
      "Writing experience bullets with action verbs…",
      "Embedding ATS keywords throughout…",
      "Formatting skills and education…",
      "Running ATS compliance check…",
      "Finalising recruiter-ready CV…",
    ];
    let si = 0;
    const ticker = setInterval(() => {
      const el = $("aiStatusText");
      if (el) el.textContent = statuses[si % statuses.length];
      si++;
    }, 2200);

    try {
      const cv = await callGroq(buildCVPrompt(), SYS_CV_WRITER, 4096, 0.5);
      clearInterval(ticker);
      aiBar.style.display = "none";
      cvOut.textContent = cv.trim();
      cvOut.contentEditable = "false";
      cvOut.style.display = "block";
      toolbar.style.display = "flex";
      if (expCard) expCard.style.display = "block";
      ["editBtn", "polishBtn"].forEach((id) => {
        const el = $(id);
        if (el) el.style.display = "inline-flex";
      });
      cvGenerated = true;
      cvBackup = cv.trim();
      updateProgress();
      showToast("✓ ATS CV generated!", "success");
      /* Show mobile PDF shortcut */
      const mobPdf = $("expPdfMob");
      if (mobPdf) mobPdf.style.display = "inline-flex";
      await runATSScore(cv);
      saveAllData();
    } catch (e) {
      clearInterval(ticker);
      aiBar.style.display = "none";
      emptyState.style.display = "flex";
      errEl.className = "alert a-err show";
      errEl.textContent = "✗ " + e.message;
      showToast(e.message, "error");
    }
    ["genBtn", "genBtn2"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = false;
    });
  }

  /* ── CV Prompt builder — fully structured ── */
  function buildCVPrompt() {
    const role       = g("targetRole"), industry = g("industry"), level = g("expLevel");
    const country    = g("country"),    format   = g("cvFormat"), jd    = g("jobDescription");
    const name       = g("fullName"),   title    = g("proTitle"), email = g("email");
    const phone      = g("phone"),      loc      = g("location"), linkedin = g("linkedin");
    const github     = g("github"),     portfolio = g("portfolio");
    const yrs        = g("yearsExp"),   spec     = g("specialization");
    const topsk      = g("topSkills"),  ach      = g("achievements"), summary = g("summary");
    const awards     = g("awards"),     volunteer = g("volunteer"), memberships = g("memberships");
    const careerGaps = g("careerGaps"), salaryExp = g("salaryExp"), remoteHybrid = g("remoteHybrid");
    const targetCompanies = g("targetCompanies"), visaStatus = g("visaStatus"), relocate = g("relocate");

    const expStr = data.experiences.length
      ? data.experiences
          .map((e) =>
            [
              `ROLE: ${safeStr(e.title)} at ${safeStr(e.company)}`,
              `DATES: ${safeStr(e.start)} – ${safeStr(e.end) || "Present"} | TYPE: ${safeStr(e.etype)} | LOCATION: ${safeStr(e.loc)}`,
              e.dept      ? `DEPARTMENT: ${safeStr(e.dept)}` : "",
              e.reporting ? `REPORTING TO: ${safeStr(e.reporting)}` : "",
              e.teamsize  ? `TEAM MANAGED: ${safeStr(e.teamsize)}` : "",
              e.tech      ? `TECHNOLOGIES/TOOLS: ${safeStr(e.tech)}` : "",
              e.volume    ? `VOLUME & SCALE: ${safeStr(e.volume)}` : "",
              `RESPONSIBILITIES: ${safeStr(e.resp) || "Not provided"}`,
              e.achiev    ? `ACHIEVEMENTS (use these numbers exactly): ${safeStr(e.achiev)}` : "",
              e.problems  ? `PROBLEMS SOLVED: ${safeStr(e.problems)}` : "",
              e.kpis      ? `KPIs MEASURED ON: ${safeStr(e.kpis)}` : "",
            ].filter(Boolean).join("\n"),
          )
          .join("\n\n")
      : "NOT PROVIDED — omit the WORK EXPERIENCE section entirely. Do not invent any jobs, companies, or dates.";

    const projStr = data.projects.length
      ? data.projects
          .map(
            (p) =>
              `PROJECT: ${safeStr(p.name)}\nROLE: ${safeStr(p.role)}\nTECH: ${safeStr(p.tech)}\nDESCRIPTION: ${safeStr(p.desc)}\nIMPACT: ${safeStr(p.impact)}\nURL: ${safeStr(p.url)}`,
          )
          .join("\n\n")
      : "NOT PROVIDED — omit the PROJECTS section entirely.";

    const eduStr = data.education.length
      ? data.education
          .map(
            (e) =>
              `DEGREE: ${safeStr(e.degree)}\nINSTITUTION: ${safeStr(e.institution)}\nYEAR: ${safeStr(e.year)}\nGRADE: ${safeStr(e.cgpa)}\nCOURSEWORK: ${safeStr(e.coursework)}`,
          )
          .join("\n\n")
      : "NOT PROVIDED — omit the EDUCATION section entirely.";

    const certStr = data.certifications.length
      ? data.certifications
          .map(
            (c) =>
              `${safeStr(c.name)} | ${safeStr(c.org)} | ${safeStr(c.date)}`,
          )
          .join("\n")
      : "NOT PROVIDED — omit the CERTIFICATIONS section entirely.";

    /* Build contact line — only include fields that have actual values */
    const contactParts = [phone, email, loc, linkedin, github, portfolio].filter(Boolean);
    const contactLine  = contactParts.join(" | ");

    /* Build skills block — omit categories with no data */
    const skillLines = [
      data.skills.tech.length  ? `Technical: ${data.skills.tech.join(", ")}` : "",
      data.skills.tool.length  ? `Tools & Platforms: ${data.skills.tool.join(", ")}` : "",
      data.skills.meth.length  ? `Methodologies: ${data.skills.meth.join(", ")}` : "",
      data.skills.soft.length  ? `Soft Skills: ${data.skills.soft.join(", ")}` : "",
      data.skills.lang.length  ? `Languages: ${data.skills.lang.join(", ")}` : "",
    ].filter(Boolean).join("\n") || "OMIT THIS SECTION — no skills provided";

    /* Summary context — only from real data */
    const summaryContext = summary ||
      [
        yrs   ? `${yrs} years of experience.` : "",
        spec  ? `Specialised in ${spec}.`     : "",
        topsk ? `Key skills: ${topsk}.`       : "",
      ].filter(Boolean).join(" ") ||
      "Write a brief professional summary based ONLY on the experience and skills provided below.";

    return `TASK: Format the candidate's data below into a professional ATS-optimized CV.

CRITICAL: Use ONLY the data provided. If a section says "NOT PROVIDED", omit it entirely — do not write the header, do not invent content.

━━━ TARGET JOB ━━━
Job Title: ${role || "Not specified"}
Industry: ${industry || "Not specified"}
Experience Level: ${level || "Not specified"}
Country/Region: ${country || "Not specified"}
CV Format: ${format || "Chronological"}
${jd ? `\n━━━ JOB DESCRIPTION (embed matching keywords only where candidate's background genuinely supports them) ━━━\n${jd.slice(0, 3500)}\n` : ""}
━━━ CANDIDATE CONTACT (use only what is provided below) ━━━
Full Name: ${name || "NOT PROVIDED — omit name line"}
Contact Line: ${contactLine || "NOT PROVIDED"}
${title ? `Professional Headline: ${title}` : ""}

━━━ PROFESSIONAL SUMMARY ━━━
${summaryContext}

━━━ WORK EXPERIENCE ━━━
${expStr}

━━━ TECHNICAL SKILLS ━━━
${skillLines}

━━━ PROJECTS ━━━
${projStr}

━━━ EDUCATION ━━━
${eduStr}

━━━ CERTIFICATIONS ━━━
${certStr}
${awards    ? "\n━━━ AWARDS & HONOURS ━━━\n" + awards       : ""}
${volunteer ? "\n━━━ VOLUNTEER WORK ━━━\n"   + volunteer    : ""}
${memberships ? "\n━━━ MEMBERSHIPS ━━━\n"    + memberships  : ""}
${ach          ? "\n━━━ KEY ACHIEVEMENTS (weave into bullets, not a separate section) ━━━\n" + ach : ""}
${careerGaps   ? "\n━━━ CAREER GAPS (context only — explain gap if shown between dates) ━━━\n" + careerGaps : ""}
${visaStatus   ? "\n━━━ VISA / WORK AUTHORISATION STATUS ━━━\n" + visaStatus : ""}
${remoteHybrid ? "\n━━━ WORK MODE PREFERENCE (context only) ━━━\n" + remoteHybrid : ""}
${targetCompanies ? "\n━━━ TARGET COMPANIES (context only — do NOT name them in CV) ━━━\n" + targetCompanies : ""}

━━━ OUTPUT RULES ━━━
1. Output plain text only — no markdown, no HTML
2. Max 450 words total — trim to highest-impact content
3. Max 3 bullets per job, max 18 words per bullet
4. Every bullet starts with a past-tense action verb
5. ONLY include metrics/numbers the candidate explicitly provided
6. Omit entire sections if marked NOT PROVIDED
7. If experience is empty: write ONLY a skills-based summary and omit WORK EXPERIENCE header
8. Never add company names, tools, metrics, or dates not in the data above`;
  }

  /* ── ATS Score (temp 0.2 — must be consistent JSON) ── */
  async function runATSScore(cvText) {
    const jd = g("jobDescription");
    try {
      const userPrompt = [
        "JOB DESCRIPTION:",
        jd
          ? jd.slice(0, 1500)
          : "No job description provided — score against general ATS best practices.",
        "\nCV TO SCORE:",
        cvText.slice(0, 3500),
      ].join("\n");
      const res = await callGroq(userPrompt, SYS_ATS_SCORER, 1024, 0.2);
      const p = extractJSON(res);
      if (!p || typeof p.score !== "number") return;

      $("scoreCard").style.display = "block";
      const sv = $("scoreVal");
      sv.textContent = p.score;
      sv.className =
        "score-val " + (p.score >= 80 ? "high" : p.score >= 55 ? "mid" : "low");
      $("scoreFill").style.width = p.score + "%";
      const topPill = $("topScorePill"),
        topVal = $("topScoreVal");
      if (topPill) topPill.style.display = "flex";
      if (topVal) topVal.textContent = p.score;

      if (Array.isArray(p.checks)) {
        $("scoreItems").innerHTML = p.checks
          .map(
            (c) =>
              `<div class="score-item ${c.pass ? "pass" : "fail"}">${c.pass ? "✓" : "✗"} ${escapeHtml(c.label)}${c.detail ? " — " + escapeHtml(c.detail) : ""}</div>`,
          )
          .join("");
      }
      const found = p.found_keywords || [],
        missing = p.missing_keywords || [];
      if (found.length || missing.length) {
        $("kwGapCard").style.display = "block";
        $("kwFound").innerHTML = found
          .map((k) => `<span class="kw kw-found">${escapeHtml(k)}</span>`)
          .join("");
        $("kwMissing").innerHTML = missing
          .map((k) => `<span class="kw kw-missing">${escapeHtml(k)}</span>`)
          .join("");
      }
    } catch (_) {
      /* silent — ATS score is non-critical */
    }
  }

  /* ═══════════════════════════════════════
     INLINE EDIT
  ═══════════════════════════════════════ */
  function toggleEdit() {
    const out = $("cvOutput");
    if (!out) return;
    if (!editMode) {
      cvBackup = out.textContent;
      out.contentEditable = "true";
      out.focus();
      editMode = true;
      $("editModeBar").classList.add("show");
      $("editBadge").style.display = "inline-flex";
      $("editBtn").innerHTML = "✎ Editing…";
    } else {
      saveEdit();
    }
  }

  function saveEdit() {
    const out = $("cvOutput");
    if (out) out.contentEditable = "false";
    editMode = false;
    $("editModeBar").classList.remove("show");
    $("editBadge").style.display = "none";
    $("editBtn").innerHTML = "✎ Edit CV";
    showToast("✓ Changes saved", "success");
    saveAllData();
  }

  function cancelEdit() {
    const out = $("cvOutput");
    if (out) {
      out.textContent = cvBackup;
      out.contentEditable = "false";
    }
    editMode = false;
    $("editModeBar").classList.remove("show");
    $("editBadge").style.display = "none";
    $("editBtn").innerHTML = "✎ Edit CV";
    showToast("Changes discarded");
  }

  /* ═══════════════════════════════════════
     EXPORTS
  ═══════════════════════════════════════ */
  function getCVText() {
    return safeStr($("cvOutput")?.textContent);
  }
  function slugify(str) {
    return safeStr(str)
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "")
      .slice(0, 40);
  }

  function triggerDownload(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copyCV() {
    const t = getCVText();
    if (!t) {
      showToast("Nothing to copy — generate first");
      return;
    }
    navigator.clipboard.writeText(t).then(
      () => showToast("✓ CV copied to clipboard", "success"),
      () => showToast("Copy failed — select text manually", "error"),
    );
  }

  function downloadTxt() {
    const name = g("fullName") || "CV",
      role = g("targetRole") || "Role";
    triggerDownload(
      new Blob([getCVText()], { type: "text/plain" }),
      `${slugify(name)}_${slugify(role)}_ATS_CV.txt`,
    );
    showToast("✓ TXT downloaded", "success");
  }


  /* ── exportHTML: download clean CV HTML file ── */
  function exportHTML() {
    const cvText = getCVText();
    if (!cvText) { showToast("Generate your CV first"); return; }
    const name = g("fullName") || "Candidate";
    const role = g("targetRole") || "Professional";
    /* Pass mode="download" — includes print hint, hides it on @media print */
    const html = buildCVHtmlDoc(cvText, name, role, "download");
    triggerDownload(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      `${slugify(name)}_${slugify(role)}_CV.html`
    );
    showToast("✓ HTML downloaded — open in browser, Ctrl+P → Save as PDF", "success", 5000);
  }

  /* ══════════════════════════════════════════════════════════════════
     buildCVHtmlDoc(cvText, name, role, mode)
     mode = "download"  → HTML file, shows print hint (hidden on print)
     mode = "print"     → New-tab print window, no hint, auto-prints
     mode = "preview"   → Screen preview only

     Matches Resume.pdf (Adeeb Danish) layout EXACTLY:
       • Name bold centered ~18pt (not uppercased by CSS)
       • Contact: 1-2 centered rows, pipe-separated, 9pt
       • Full-width rule under header
       • Section headers: ALL CAPS bold, border-bottom
       • Experience: [Job Title · Company    Date] flex row
       • Sub-line: Location / type, normal weight
       • Bullets: indented, dash or bullet char, 10pt
       • Projects: name bold, bullet desc, italic tech line
       • Skills: Bold label: inline values
       • Education: [Degree · Institution    Year] flex row
       • Certifications: bullet list
  ══════════════════════════════════════════════════════════════════ */
  function buildCVHtmlDoc(cvText, name, role, mode) {
    if (!cvText || !cvText.trim()) return "";
    const lines = cvText.split("\n");
    let bodyHtml = "";
    let i = 0;
    const N = lines.length;

    /* ── Helpers ── */
    const esc    = (s) => escapeHtml(safeStr(s));
    /* Strip markdown bold/italic artifacts the AI sometimes outputs */
    const clean  = (s) => safeStr(s).replace(/\*\*|__/g, "").replace(/\*(.*?)\*/g, "$1");
    const ec     = (s) => esc(clean(s));

    const hasYear  = (t) => /\b(19|20)\d{2}\b/.test(t);
    const isBullet = (t) => /^[•–\-]\s/.test(t) || t.startsWith("• ");
    const isCapsHeader = (t) =>
      t.length > 2 &&
      t === t.toUpperCase() &&
      /[A-Z]/.test(t) &&
      !hasYear(t) &&
      !isBullet(t) &&
      !/^\d/.test(t) &&
      !t.includes("@");
    const isContact = (t) =>
      t.length < 260 &&
      (t.includes("|") || t.includes("@") || /^\+\d/.test(t) ||
       /linkedin|github/i.test(t));
    const isSkillRow = (t) =>
      /^[A-Za-z][A-Za-z ,&\/\(\)]+:\s+\S/.test(t) &&
      !hasYear(t) && !isBullet(t) && !isCapsHeader(t);

    const nextNonEmpty = (from) => {
      for (let j = from + 1; j < N; j++) {
        const t = lines[j].trim();
        if (t) return t;
      }
      return "";
    };

    /* ══ PARSE DATE from end of line ══
       "Freelance Full-Stack Developer  2023 – Present"
       "Bachelor of Science | University  2020 – 2024"
       Returns { title, date } or null                  */
    const splitTitleDate = (t) => {
      /* Patterns: "Title  YYYY – YYYY", "Title  YYYY – Present", "Title  YYYY" */
      const m =
        t.match(/^(.+?)\s{2,}(\d{4}\s*[–\-—]\s*(?:\d{4}|[Pp]resent))\s*$/) ||
        t.match(/^(.+?)\s+(\d{4}\s*[–\-—]\s*(?:\d{4}|[Pp]resent))\s*$/)    ||
        t.match(/^(.+?)\s{2,}(\d{4})\s*$/);
      if (!m) return null;
      return { title: m[1].trim(), date: m[2].trim() };
    };

    /* ══ NAME: first non-empty line ══ */
    while (i < N && !lines[i].trim()) i++;
    const candidateName = i < N ? ec(lines[i].trim()) : ec(name);
    i++;

    /* ══ CONTACT ROWS: consecutive contact-style lines ══ */
    const contactRows = [];
    while (i < N) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }
      if (isContact(t)) {
        const parts = t.split("|").map(p => ec(p.trim())).filter(Boolean);
        contactRows.push(parts.join('<span class="pipe"> | </span>'));
        i++;
      } else {
        break;
      }
    }

    bodyHtml += `<div class="cv-header">
  <div class="cv-name">${candidateName}</div>
  <div class="cv-contact">${contactRows.map(r => `<div class="contact-row">${r}</div>`).join("")}</div>
  <div class="cv-header-rule"></div>
</div>`;

    /* ══ BODY: section by section ══ */
    while (i < N) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }

      /* SECTION HEADER */
      if (isCapsHeader(t)) {
        bodyHtml += `\n<div class="cv-section">\n<div class="cv-sh">${ec(t)}</div>`;
        i++;

        /* Collect section content */
        while (i < N) {
          const rt = lines[i].trim();
          /* Next section header = end of this section */
          if (rt && isCapsHeader(rt)) break;
          if (!rt) { i++; continue; }

          /* ── BULLET ── */
          if (isBullet(rt)) {
            const raw  = rt.replace(/^[•–\-]\s*/, "");
            const char = rt[0] === "•" ? "•" : "–";
            /* Tech sub-line inside projects: "Tech: Go, SQL" */
            if (/^[Tt]ech:\s/.test(raw)) {
              bodyHtml += `<div class="proj-tech">${ec(raw)}</div>`;
            } else {
              bodyHtml += `<div class="cv-bullet"><span class="bchar">${char}</span><span class="btext">${ec(raw)}</span></div>`;
            }
            i++; continue;
          }

          /* ── SKILL ROW ── */
          if (isSkillRow(rt)) {
            const colon = rt.indexOf(":");
            const label = rt.slice(0, colon + 1);
            const value = rt.slice(colon + 1).trim();
            bodyHtml += `<div class="cv-skill"><span class="sk-label">${ec(label)}</span><span class="sk-value"> ${ec(value)}</span></div>`;
            i++; continue;
          }

          /* ── LINE WITH INLINE DATE (title + date on same line) ── */
          if (hasYear(rt) && rt.length < 130) {
            const sd = splitTitleDate(rt);
            if (sd) {
              bodyHtml += `<div class="cv-entry-row"><span class="entry-title">${ec(sd.title)}</span><span class="entry-date">${ec(sd.date)}</span></div>`;
              i++; continue;
            }
            /* Has year but doesn't split cleanly → meta line */
            bodyHtml += `<div class="cv-entry-meta">${ec(rt)}</div>`;
            i++; continue;
          }

          /* ── ENTRY TITLE or META ── */
          const nxt = nextNonEmpty(i);
          /* If next line has year OR is a short meta → this is a title */
          const nxtHasYear = hasYear(nxt) && nxt.length < 130;
          const nxtIsMeta  = nxt && !isBullet(nxt) && !isCapsHeader(nxt) &&
                             !isSkillRow(nxt) && nxt.length < 100 && !hasYear(nxt);
          const nxtIsBullet = isBullet(nxt);

          if (nxtHasYear || nxtIsMeta || nxtIsBullet) {
            /* Determine if bold (title) or normal (meta) */
            /* First occurrence in a group of lines → title */
            bodyHtml += `<div class="cv-entry-title">${ec(rt)}</div>`;
            i++; continue;
          }

          /* Short non-date, non-bullet line after a title → meta */
          if (rt.length < 90 && !isCapsHeader(rt) && !isSkillRow(rt)) {
            bodyHtml += `<div class="cv-entry-meta">${ec(rt)}</div>`;
            i++; continue;
          }

          /* Paragraph fallback */
          bodyHtml += `<div class="cv-para">${ec(rt)}</div>`;
          i++;
        }

        bodyHtml += `\n</div>`; /* close cv-section */
        continue;
      }

      /* Top-level content before any section */
      bodyHtml += `<div class="cv-para">${ec(t)}</div>`;
      i++;
    }

    /* ══ CSS ══ */
    const css = `
/* ── Reset ── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── Page (print) ── */
@page{size:A4 portrait;margin:18mm 20mm 18mm 20mm}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* ── Body ── */
body{
  font-family:"Calibri","Segoe UI","Helvetica Neue",Arial,sans-serif;
  font-size:10.5pt;
  line-height:1.45;
  color:#111;
  background:#fff;
}

/* ── Screen container ── */
@media screen{
  body{
    max-width:170mm;
    margin:0 auto;
    padding:24px 28px;
    box-shadow:0 2px 24px rgba(0,0,0,.13);
    min-height:297mm;
  }
}

/* ── Print hint bar ── */
.print-hint{
  background:#f0f4ff;
  border:1px solid #c5d8f5;
  border-radius:6px;
  padding:9px 14px;
  font-size:10.5px;
  font-family:Arial,sans-serif;
  color:#2a3a5c;
  text-align:center;
  margin-bottom:18px;
  line-height:1.55;
}
@media print{
  .print-hint{display:none!important}
  body{padding:0;max-width:none}
}

/* ── Header ── */
.cv-header{margin-bottom:0}
.cv-name{
  font-size:18pt;
  font-weight:700;
  text-align:center;
  color:#0a0a0a;
  line-height:1.15;
  margin-bottom:2.5pt;
}
.cv-contact{
  text-align:center;
  font-size:9pt;
  color:#222;
  line-height:1.6;
  margin-bottom:4.5pt;
}
.contact-row{display:block}
.pipe{color:#555;margin:0 1.5pt}
.cv-header-rule{
  border:none;
  border-top:1pt solid #111;
  margin-bottom:0;
}

/* ── Sections ── */
.cv-section{margin-top:8pt}
.cv-sh{
  font-size:10pt;
  font-weight:700;
  letter-spacing:.05em;
  text-transform:uppercase;
  color:#0a0a0a;
  border-bottom:.75pt solid #333;
  padding-bottom:1.5pt;
  margin-bottom:4pt;
  page-break-after:avoid;
}

/* ── Entry row: title left + date right ── */
.cv-entry-row{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  gap:6pt;
  font-size:10.5pt;
  font-weight:700;
  color:#0a0a0a;
  margin-top:5pt;
  margin-bottom:0;
  page-break-after:avoid;
}
.entry-title{flex:1;font-weight:700}
.entry-date{
  flex-shrink:0;
  font-weight:400;
  font-size:10pt;
  color:#222;
  white-space:nowrap;
}

/* ── Entry title (no date on same line) ── */
.cv-entry-title{
  font-size:10.5pt;
  font-weight:700;
  color:#0a0a0a;
  margin-top:5pt;
  margin-bottom:0;
  page-break-after:avoid;
}

/* ── Entry meta: company / institution / location ── */
.cv-entry-meta{
  font-size:10pt;
  font-weight:400;
  color:#333;
  margin-top:.5pt;
  margin-bottom:1pt;
}

/* ── Bullets ── */
.cv-bullet{
  display:flex;
  align-items:flex-start;
  gap:3pt;
  padding-left:10pt;
  margin-top:2pt;
  margin-bottom:0;
  font-size:10pt;
  line-height:1.43;
}
.bchar{flex-shrink:0;width:7pt;color:#222;margin-top:.3pt}
.btext{flex:1}

/* ── Project tech sub-line ── */
.proj-tech{
  font-size:9.5pt;
  color:#444;
  padding-left:17pt;
  margin-top:.5pt;
  margin-bottom:1pt;
  font-style:italic;
}

/* ── Skills ── */
.cv-skill{font-size:10pt;line-height:1.43;margin-top:2pt}
.sk-label{font-weight:700}
.sk-value{font-weight:400;color:#111}

/* ── Paragraph ── */
.cv-para{font-size:10pt;line-height:1.45;margin-top:2.5pt;color:#111}

/* ── Print page-break rules ── */
@media print{
  .cv-sh{page-break-after:avoid}
  .cv-entry-row{page-break-after:avoid}
  .cv-entry-title{page-break-after:avoid}
  .cv-bullet{page-break-inside:avoid}
}
`;

    /* Print hint: shown on screen, hidden on @media print */
    const hint = (mode === "download")
      ? `<div class="print-hint">
  📄 <strong>Save as PDF:</strong> Press <strong>Ctrl+P</strong> (Windows) or <strong>Cmd+P</strong> (Mac)
  &nbsp;→&nbsp; Destination: <strong>Save as PDF</strong>
  &nbsp;→&nbsp; Paper size: <strong>A4</strong>
  &nbsp;→&nbsp; Margins: <strong>Default</strong>
  &nbsp;→&nbsp; Click <strong>Save</strong>
</div>`
      : "";

    /* Auto-print script for print mode */
    const autoPrint = (mode === "print")
      ? `<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)});<\/script>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ec(name)} — ${ec(role)} CV</title>
<style>${css}</style>
${autoPrint}
</head>
<body>
${hint}${bodyHtml}
</body>
</html>`;
  }

  /* ── buildPDFHtml alias (backward compat) ── */
  function buildPDFHtml(cvText, name, role) {
    return buildCVHtmlDoc(cvText, name, role, "print");
  }

  /* ══════════════════════════════════════════════════════════════
     exportPDF
     Strategy: open CV in new tab with mode="print"
     The page auto-calls window.print() after load.
     User picks "Save as PDF" in the system print dialog.
     This is the MOST reliable cross-device approach:
       ✓ Chrome, Firefox, Safari, Edge
       ✓ iOS Safari (share → Print)
       ✓ Android Chrome (⋮ → Print)
       ✓ No CDN dependency
       ✓ Vector text (not rasterized JPEG)
       ✓ Exact A4 @page margins respected
       ✓ Works offline
  ══════════════════════════════════════════════════════════════ */
  function exportPDF() {
    const cvText = getCVText();
    if (!cvText) { showToast("Generate your CV first"); return; }
    const name = g("fullName") || "Candidate";
    const role = g("targetRole") || "Professional";

    const html = buildCVHtmlDoc(cvText, name, role, "print");
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);

    const w = window.open(url, "_blank");
    if (!w) {
      /* Popup blocked — fallback: download HTML with instructions */
      URL.revokeObjectURL(url);
      showToast("Popups blocked — downloading HTML file instead. Open it and press Ctrl+P → Save as PDF.", "error", 7000);
      triggerDownload(
        new Blob([buildCVHtmlDoc(cvText, name, role, "download")], { type: "text/html;charset=utf-8" }),
        `${slugify(name)}_${slugify(role)}_CV_print.html`
      );
      return;
    }

    /* Revoke blob URL after the window has had time to load */
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast("📄 Print dialog opening — choose 'Save as PDF' → A4 → Default margins", "", 6000);
  }

  /* RTF export */
  function exportRtf() {
    const cvText = getCVText();
    const name = g("fullName") || "Candidate",
      role = g("targetRole") || "Professional";
    const lines = cvText.split("\n");
    let body = "";
    lines.forEach((line) => {
      const esc = line
        .replace(/\\/g, "\\\\")
        .replace(/\{/g, "\\{")
        .replace(/\}/g, "\\}")
        .replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0) + "?");
      const isCaps =
        line.trim() &&
        line.trim() === line.trim().toUpperCase() &&
        line.trim().length > 2 &&
        !line.trim().startsWith("•");
      if (isCaps) body += `\\pard\\sb240\\sa60\\b\\fs22 ${esc}\\b0\\par\n`;
      else if (line.trim().startsWith("•"))
        body += `\\pard\\fi-200\\li280\\sa40 ${esc}\\par\n`;
      else if (!line.trim()) body += `\\pard\\sa60\\par\n`;
      else body += `\\pard\\sa40 ${esc}\\par\n`;
    });
    const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\n{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\n{\\info{\\title ${escapeAttr(name)} CV}}\n\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1200\n\\f0\\fs21\\sl252\\slmult1\n${body}\n}`;
    triggerDownload(
      new Blob([rtf], { type: "application/rtf" }),
      `${slugify(name)}_${slugify(role)}_ATS_CV.rtf`,
    );
    showToast(
      "✓ RTF/Word file downloaded — open in Microsoft Word or Google Docs.",
      "success",
    );
  }

  /* ═══════════════════════════════════════
     ENTRY MODAL
  ═══════════════════════════════════════ */
  function openModal(type, idx) {
    modalType = type;
    modalEditIdx = idx !== undefined && idx !== null ? Number(idx) : -1;
    const titles = {
      exp: "Work Experience",
      proj: "Project",
      edu: "Education",
      cert: "Certification",
    };
    const titleEl = $("modalTitle");
    if (titleEl)
      titleEl.textContent =
        (modalEditIdx >= 0 ? "Edit " : "Add ") + (titles[type] || "Entry");
    const bodyEl = $("modalBody");
    if (bodyEl) bodyEl.innerHTML = buildModalFields(type, modalEditIdx);
    $("overlay")?.classList.add("open");
    setTimeout(() => {
      wireDatePickers();
      document
        .querySelector(".modal-body input, .modal-body textarea")
        ?.focus();
    }, 100);
  }

  function buildModalFields(type, idx) {
    if (type === "exp") {
      const d = idx >= 0 ? data.experiences[idx] || {} : {};
      return `
<div class="g2">
  <div class="field">
    <label>Job Title <span class="req">*</span></label>
    <input id="mf_title" value="${escapeAttr(d.title)}" placeholder="e.g. Backend Developer, Sales Manager">
    <div class="fhint">💬 Use the exact title from your employment contract or offer letter.</div>
  </div>
  <div class="field">
    <label>Company / Organisation <span class="req">*</span></label>
    <input id="mf_company" value="${escapeAttr(d.company)}" placeholder="e.g. Infosys, Freelance, Self-Employed">
    <div class="fhint">💬 Official company name. Write "Freelance" or "Self-Employed" if applicable.</div>
  </div>
</div>
<div class="g3">
  <div class="field">
    <label>Start Date</label>
    ${dateInput("mf_start", d.start, "Jan 2022")}
    <div class="fhint">💬 Pick from calendar or type e.g. "Jan 2022".</div>
  </div>
  <div class="field">
    <label>End Date</label>
    ${dateInput("mf_end", d.end, "Present")}
    <div class="fhint">💬 Leave blank or type "Present" if this is your current job.</div>
  </div>
  <div class="field">
    <label>Employment Type</label>
    <select id="mf_etype">
      <option value="">Select…</option>
      ${["Full-time","Part-time","Contract","Freelance","Internship"].map(o=>`<option value="${o}"${d.etype===o?" selected":""}>${o}</option>`).join("")}
    </select>
  </div>
</div>
<div class="g2">
  <div class="field">
    <label>Location / Remote</label>
    <input id="mf_loc" value="${escapeAttr(d.loc)}" placeholder="e.g. Kozhikode, India / Remote">
    <div class="fhint">💬 City and country, or write "Remote".</div>
  </div>
  <div class="field">
    <label>Department / Team</label>
    <input id="mf_dept" value="${escapeAttr(d.dept)}" placeholder="e.g. Engineering, Sales, Operations">
    <div class="fhint">💬 Which team or department were you part of?</div>
  </div>
</div>
<div class="g2">
  <div class="field">
    <label>Reporting To</label>
    <input id="mf_reporting" value="${escapeAttr(d.reporting)}" placeholder="e.g. Senior Engineer, Branch Manager">
    <div class="fhint">💬 Your direct manager's title (not name). Helps show seniority context.</div>
  </div>
  <div class="field">
    <label>Team Size Managed (if any)</label>
    <input id="mf_teamsize" value="${escapeAttr(d.teamsize)}" placeholder="e.g. 5 direct reports, 12-person team">
    <div class="fhint">💬 Only if you managed or supervised others. Leave blank if not applicable.</div>
  </div>
</div>
<div class="field">
  <label>Technologies, Tools &amp; Systems Used <span class="badge b-key" style="font-size:9px">ATS Key</span></label>
  <input id="mf_tech" value="${escapeAttr(d.tech)}" placeholder="Python, SAP, Salesforce, Excel, POS, ERP, Jira, Tally…">
  <div class="fhint">💬 Every tool you used — software, systems, platforms. Be specific: "SAP S/4HANA" not "SAP".</div>
</div>
<div class="field">
  <label>Volume &amp; Scale <span style="font-weight:400;color:var(--text3)">(numbers matter most here)</span></label>
  <textarea id="mf_volume" style="min-height:65px" placeholder="e.g.&#10;- Handled 200+ customer orders daily&#10;- Managed inventory worth ₹50L&#10;- Processed 500 invoices/month&#10;- Supported 30 branches across 3 states">${escapeHtml(d.volume||"")}</textarea>
  <div class="fhint">💬 Revenue, sales targets, customers handled, orders processed, accounts managed — any numbers you can recall.</div>
</div>
<div class="field">
  <label>Daily Responsibilities <span style="font-weight:400;color:var(--text3)">(what you actually did every day)</span></label>
  <textarea id="mf_resp" style="min-height:100px" placeholder="e.g.&#10;- Managed PostgreSQL database design and migrations&#10;- Handled customer onboarding and account setup&#10;- Prepared daily sales reports and submitted to manager&#10;- Coordinated with vendors for stock replenishment">${escapeHtml(d.resp||"")}</textarea>
  <div class="fhint">💬 Write in plain language — what did you do daily/weekly? AI will rewrite as professional CV bullets.</div>
</div>
<div class="field">
  <label>Achievements &amp; Results <span style="font-weight:400;color:var(--text3)">(only real numbers — don't guess)</span></label>
  <textarea id="mf_achiev" style="min-height:80px" placeholder="e.g.&#10;- Reduced delivery delays by 30% through route optimisation&#10;- Consistently met 110% of monthly sales target&#10;- Received Best Employee award Q3 2023&#10;- Trained 8 new joiners over 2 years">${escapeHtml(d.achiev||"")}</textarea>
  <div class="fhint">💬 Only enter achievements you can verify. If you don't have exact numbers, describe the outcome without inventing a percentage.</div>
</div>
<div class="field">
  <label>Problems You Solved</label>
  <textarea id="mf_problems" style="min-height:65px" placeholder="e.g.&#10;- Reduced customer complaints by fixing broken returns workflow&#10;- Identified billing errors saving ₹2L/month&#10;- Reduced team overtime by redesigning shift schedule">${escapeHtml(d.problems||"")}</textarea>
  <div class="fhint">💬 Specific situations where you identified and fixed a problem. Great for distinguishing yourself.</div>
</div>
<div class="g2">
  <div class="field">
    <label>KPIs / Targets You Were Measured On</label>
    <input id="mf_kpis" value="${escapeAttr(d.kpis)}" placeholder="e.g. 95% SLA, ₹10L monthly sales, 98% accuracy">
    <div class="fhint">💬 What metrics was your performance measured against? Enter real targets.</div>
  </div>
  <div class="field">
    <label>Reason for Leaving (optional)</label>
    <input id="mf_leaving" value="${escapeAttr(d.leaving)}" placeholder="e.g. Better opportunity, Contract ended, Relocation">
    <div class="fhint">💬 Not shown in CV but helps AI understand your career path.</div>
  </div>
</div>
<button class="btn btn-ai btn-sm" style="margin-top:.3rem;align-self:flex-start" id="enhanceBtn">✦ AI Enhance Bullets</button>
<div class="tip-box" style="margin-top:.4rem;font-size:11.5px"><span class="tip-icon">💡</span><span>Fill responsibilities above, then click AI Enhance. AI will rephrase using your exact data — it will NOT invent metrics you didn't provide.</span></div>`;
    }
        if (type === "proj") {
      const d = idx >= 0 ? data.projects[idx] || {} : {};
      return `
<div class="field">
  <label>Project Name <span class="req">*</span></label>
  <input id="mf_pname" value="${escapeAttr(d.name)}" placeholder="e.g. Biscut ORM, Django Auth System, Portfolio Site">
  <div class="fhint">💬 Use the name as it appears on GitHub or in your portfolio.</div>
</div>
<div class="field">
  <label>Technologies Used <span class="badge b-key" style="font-size:9px">ATS Key</span></label>
  <input id="mf_ptech" value="${escapeAttr(d.tech)}" placeholder="Go, SQL, Python, Django, WebSockets, Docker…">
  <div class="fhint">💬 Exact names — these get matched by ATS systems. Separate with commas.</div>
</div>
<div class="g2">
  <div class="field">
    <label>Your Role</label>
    <input id="mf_prole" value="${escapeAttr(d.role)}" placeholder="e.g. Solo Developer, Backend Lead">
    <div class="fhint">💬 Solo = you built it alone. Lead = you led a team.</div>
  </div>
  <div class="field">
    <label>GitHub / Live Link</label>
    <input type="url" id="mf_purl" value="${escapeAttr(d.url)}" placeholder="https://github.com/you/project">
    <div class="fhint">💬 Add the full URL — some ATS systems and recruiters check these.</div>
  </div>
</div>
<div class="field">
  <label>What does it do? (Description)</label>
  <textarea id="mf_pdesc" placeholder="Briefly explain what the project does and why you built it.&#10;e.g. A lightweight Go ORM for working with SQL databases without fully abstracting SQL.">${escapeHtml(d.desc || "")}</textarea>
  <div class="fhint">💬 1–2 sentences is enough. Focus on the problem it solves.</div>
</div>
<div class="field">
  <label>Impact / Results</label>
  <input id="mf_pimp" value="${escapeAttr(d.impact)}" placeholder="e.g. 200+ GitHub stars, used by 500 users, open-source">
  <div class="fhint">💬 Any numbers — downloads, users, stars, or even "personal/learning project" is fine.</div>
</div>`;
    }
    if (type === "edu") {
      const d = idx >= 0 ? data.education[idx] || {} : {};
      return `
<div class="field">
  <label>Full Degree Name <span class="req">*</span></label>
  <input id="mf_deg" value="${escapeAttr(d.degree)}" placeholder="e.g. Bachelor of Technology in Mechanical Engineering">
  <div class="fhint">💬 Write the full name — "Bachelor of Technology" not "B.Tech". ATS matches exact strings.</div>
</div>
<div class="field">
  <label>College / University <span class="req">*</span></label>
  <input id="mf_inst" value="${escapeAttr(d.institution)}" placeholder="e.g. AWH Engineering College, Kozhikode">
  <div class="fhint">💬 Include the city if the name isn't widely known.</div>
</div>
<div class="g3">
  <div class="field">
    <label>Year Range</label>
    <input id="mf_year" value="${escapeAttr(d.year)}" placeholder="2020 – 2024">
    <div class="fhint">💬 e.g. "2020 – 2024" or just "2024" for completion year.</div>
  </div>
  <div class="field">
    <label>Grade / CGPA (optional)</label>
    <input id="mf_cgpa" value="${escapeAttr(d.cgpa)}" placeholder="e.g. 7.8/10 or 2:1">
    <div class="fhint">💬 Only include if 7.5+/10 or 3.5+/4.0. Leave blank otherwise.</div>
  </div>
  <div class="field">
    <label>Relevant Subjects</label>
    <input id="mf_course" value="${escapeAttr(d.coursework)}" placeholder="e.g. Data Structures, OS, Networks">
    <div class="fhint">💬 Only if applying for a role closely related to your degree subjects.</div>
  </div>
</div>`;
    }
    if (type === "cert") {
      const d = idx >= 0 ? data.certifications[idx] || {} : {};
      return `
<div class="field">
  <label>Full Certificate Name <span class="req">*</span></label>
  <input id="mf_cname" value="${escapeAttr(d.name)}" placeholder="e.g. Python for Everybody Specialization">
  <div class="fhint">💬 Use the full official name as shown on your certificate.</div>
</div>
<div class="g2">
  <div class="field">
    <label>Issued By</label>
    <input id="mf_corg" value="${escapeAttr(d.org)}" placeholder="e.g. Coursera, Google, AWS, Microsoft">
    <div class="fhint">💬 The platform or company that issued the certificate.</div>
  </div>
  <div class="field">
    <label>Date Completed</label>
    ${dateInput("mf_cdate", d.date, "Mar 2024")}
    <div class="fhint">💬 Pick from calendar or type e.g. "Mar 2024".</div>
  </div>
</div>
<div class="field">
  <label>Certificate URL (optional)</label>
  <input type="url" id="mf_curl" value="${escapeAttr(d.url)}" placeholder="https://coursera.org/verify/...">
  <div class="fhint">💬 The verification link from your certificate. Adds credibility.</div>
</div>`;
    }
    return "";
  }

  function closeModal() {
    $("overlay")?.classList.remove("open");
  }

  function mv(id) {
    return safeStr($(id)?.value);
  }

  function saveModal() {
    if (modalType === "exp") {
      const o = {
        title:    mv("mf_title"),
        company:  mv("mf_company"),
        start:    mv("mf_start"),
        end:      mv("mf_end"),
        etype:    mv("mf_etype"),
        loc:      mv("mf_loc"),
        dept:     mv("mf_dept"),
        reporting:mv("mf_reporting"),
        teamsize: mv("mf_teamsize"),
        tech:     mv("mf_tech"),
        volume:   mv("mf_volume"),
        resp:     mv("mf_resp"),
        achiev:   mv("mf_achiev"),
        problems: mv("mf_problems"),
        kpis:     mv("mf_kpis"),
        leaving:  mv("mf_leaving"),
      };
      if (!o.title || !o.company) {
        showToast("Job title and company required");
        return;
      }
      modalEditIdx >= 0
        ? (data.experiences[modalEditIdx] = o)
        : data.experiences.push(o);
      renderList("exp");
    } else if (modalType === "proj") {
      const o = {
        name: mv("mf_pname"),
        tech: mv("mf_ptech"),
        role: mv("mf_prole"),
        url: mv("mf_purl"),
        desc: mv("mf_pdesc"),
        impact: mv("mf_pimp"),
      };
      if (!o.name) {
        showToast("Project name required");
        return;
      }
      modalEditIdx >= 0
        ? (data.projects[modalEditIdx] = o)
        : data.projects.push(o);
      renderList("proj");
    } else if (modalType === "edu") {
      const o = {
        degree: mv("mf_deg"),
        institution: mv("mf_inst"),
        year: mv("mf_year"),
        cgpa: mv("mf_cgpa"),
        coursework: mv("mf_course"),
      };
      if (!o.degree || !o.institution) {
        showToast("Degree and institution required");
        return;
      }
      modalEditIdx >= 0
        ? (data.education[modalEditIdx] = o)
        : data.education.push(o);
      renderList("edu");
    } else if (modalType === "cert") {
      const o = {
        name: mv("mf_cname"),
        org: mv("mf_corg"),
        date: mv("mf_cdate"),
        url: mv("mf_curl"),
      };
      if (!o.name) {
        showToast("Certification name required");
        return;
      }
      modalEditIdx >= 0
        ? (data.certifications[modalEditIdx] = o)
        : data.certifications.push(o);
      renderList("cert");
    }
    closeModal();
    updateProgress();
    saveAllData();
  }

  /* ─────────── RENDER LISTS ─────────── */
  function renderList(type) {
    const maps = {
      exp: {
        id: "expList",
        arr: "experiences",
        fn: (e) =>
          `<div class="ecard-title">${escapeHtml(safeStr(e.title))} — ${escapeHtml(safeStr(e.company))}</div>
         <div class="ecard-sub">${escapeHtml(safeStr(e.start))}${e.end ? " – " + escapeHtml(safeStr(e.end)) : ""} · ${escapeHtml(safeStr(e.etype))} ${e.loc ? "· " + escapeHtml(safeStr(e.loc)) : ""}</div>
         ${
           e.tech
             ? `<div class="etags">${safeStr(e.tech)
                 .split(",")
                 .slice(0, 5)
                 .map(
                   (t) => `<span class="etag">${escapeHtml(t.trim())}</span>`,
                 )
                 .join("")}</div>`
             : ""
         }`,
      },
      proj: {
        id: "projList",
        arr: "projects",
        fn: (p) =>
          `<div class="ecard-title">${escapeHtml(safeStr(p.name))}</div>
         <div class="ecard-sub">${escapeHtml(safeStr(p.role))}${p.impact ? " · " + escapeHtml(safeStr(p.impact)) : ""}</div>
         ${
           p.tech
             ? `<div class="etags">${safeStr(p.tech)
                 .split(",")
                 .slice(0, 4)
                 .map(
                   (t) => `<span class="etag">${escapeHtml(t.trim())}</span>`,
                 )
                 .join("")}</div>`
             : ""
         }`,
      },
      edu: {
        id: "eduList",
        arr: "education",
        fn: (e) =>
          `<div class="ecard-title">${escapeHtml(safeStr(e.degree))}</div>
         <div class="ecard-sub">${escapeHtml(safeStr(e.institution))}${e.year ? " · " + escapeHtml(safeStr(e.year)) : ""}${e.cgpa ? " · " + escapeHtml(safeStr(e.cgpa)) : ""}</div>`,
      },
      cert: {
        id: "certList",
        arr: "certifications",
        fn: (c) =>
          `<div class="ecard-title">${escapeHtml(safeStr(c.name))}</div>
         <div class="ecard-sub">${escapeHtml(safeStr(c.org))} · ${escapeHtml(safeStr(c.date))}</div>`,
      },
    };
    const m = maps[type];
    if (!m) return;
    const el = $(m.id);
    if (!el) return;
    el.innerHTML = data[m.arr]
      .map(
        (item, i) =>
          `<div class="ecard">
        <div class="ecard-body">${m.fn(item)}</div>
        <div class="ecard-actions">
          <button class="btn btn-ghost btn-icon btn-sm" data-edit-type="${type}" data-edit-idx="${i}" title="Edit">✎</button>
          <button class="btn btn-danger btn-icon btn-sm" data-del-arr="${m.arr}" data-del-idx="${i}" data-del-type="${type}" title="Delete">✕</button>
        </div>
      </div>`,
      )
      .join("");
  }

  function removeItem(arr, i, type) {
    data[arr].splice(Number(i), 1);
    renderList(type);
    updateProgress();
    saveAllData();
  }

  /* ─────────── SKILLS ─────────── */
  function addSkill(type) {
    const map = SKILL_MAP[type];
    if (!map) return;
    const inp = $(map.input);
    if (!inp) return;
    const val = safeStr(inp.value);
    if (!val) return;
    val
      .split(",")
      .map((s) => safeStr(s))
      .filter(Boolean)
      .forEach((s) => {
        if (!data.skills[type].includes(s)) data.skills[type].push(s);
      });
    inp.value = "";
    renderTags(type);
    updateProgress();
    saveAllData();
  }

  function renderTags(type) {
    const map = SKILL_MAP[type];
    if (!map) return;
    const el = $(map.tags);
    if (!el) return;
    el.innerHTML = data.skills[type]
      .map(
        (s, i) =>
          `<span class="chip">${escapeHtml(s)}<button class="chip-x" data-remove-skill="${type}" data-remove-idx="${i}" aria-label="Remove ${escapeAttr(s)}">×</button></span>`,
      )
      .join("");
  }

  function removeSkill(type, i) {
    data.skills[type].splice(Number(i), 1);
    renderTags(type);
    saveAllData();
  }

  /* ─────────── EXPORT DATA (JSON) ─────────── */
  function exportData() {
    try {
      const snapshot = {
        meta: {
          exported: new Date().toISOString(),
          app: "CVForge Pro v4",
          version: "2024-structured-export",
        },
        target: {
          role: g("targetRole"),
          industry: g("industry"),
          level: g("expLevel"),
          country: g("country"),
          format: g("cvFormat"),
        },
        contact: {
          fullName: g("fullName"),
          proTitle: g("proTitle"),
          email: g("email"),
          phone: g("phone"),
          location: g("location"),
          linkedin: g("linkedin"),
          github: g("github"),
          portfolio: g("portfolio"),
        },
        summary: {
          yearsExp: g("yearsExp"),
          specialization: g("specialization"),
          topSkills: g("topSkills"),
          achievements: g("achievements"),
          summary: g("summary"),
        },
        experience: data.experiences,
        skills: data.skills,
        projects: data.projects,
        education: data.education,
        certifications: data.certifications,
        additional: {
          awards: g("awards"),
          volunteer: g("volunteer"),
          memberships: g("memberships"),
        },
        keywords: data.keywords,
        jobDescription: g("jobDescription"),
      };
      const json = JSON.stringify(snapshot, null, 2);
      const name = g("fullName") || "CVForge";
      triggerDownload(
        new Blob([json], { type: "application/json" }),
        `${slugify(name)}_CVForge_Data_${new Date().toISOString().slice(0, 10)}.json`,
      );
      showToast(
        "✓ Data exported as JSON — use to back up or transfer your profile.",
        "success",
      );
    } catch (e) {
      showToast("Export failed: " + e.message, "error");
    }
  }

  /* ─────────── DATE PICKER HELPER ─────────── */
  /* Renders a month/year date input that degrades to text */
  function dateInput(id, val, placeholder) {
    const v = escapeAttr(val);
    const p = escapeAttr(placeholder);
    /* month input supported in Chrome/Edge; Safari/Firefox fall back to text */
    return `<div class="date-input-wrap">
      <input type="month" id="${id}_picker" class="date-picker-input" value="${v ? toMonthValue(v) : ""}" title="Pick a date">
      <input type="text"  id="${id}" value="${v}" placeholder="${p}" class="date-text-input" autocomplete="off" maxlength="30">
    </div>`;
  }

  /* Convert "Jan 2022" or "2022" to YYYY-MM for month input */
  function toMonthValue(str) {
    if (!str || str.toLowerCase() === "present") return "";
    const months = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const parts = str.trim().split(/\s+/);
    if (parts.length === 2) {
      const mon = months[parts[0].toLowerCase().slice(0, 3)];
      const yr = parts[1];
      if (mon && yr) return `${yr}-${mon}`;
    }
    if (/^\d{4}$/.test(parts[0])) return `${parts[0]}-01`;
    return "";
  }

  /* Convert YYYY-MM from month input to "Mon YYYY" */
  function fromMonthValue(val) {
    if (!val) return "";
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const [yr, m] = val.split("-");
    if (yr && m) return `${months[parseInt(m, 10) - 1]} ${yr}`;
    return val;
  }

  /* Wire date pickers after modal opens */
  function wireDatePickers() {
    document.querySelectorAll(".date-picker-input").forEach((picker) => {
      const textId = picker.id.replace("_picker", "");
      const textEl = $(textId);
      if (!textEl) return;
      /* picker → text */
      picker.addEventListener("change", () => {
        if (picker.value) textEl.value = fromMonthValue(picker.value);
      });
      /* text → picker (sync) */
      textEl.addEventListener("input", () => {
        const mv = toMonthValue(textEl.value);
        if (mv) picker.value = mv;
      });
    });
  }

  /* ─────────── TUTORIAL ─────────── */
  function openTutorial() {
    $("tutorialOverlay")?.classList.add("open");
  }
  function closeTutorial() {
    $("tutorialOverlay")?.classList.remove("open");
  }

  /* ═══════════════════════════════════════
     EVENT LISTENERS
  ═══════════════════════════════════════ */
  function setupEventListeners() {
    /* Sidebar + mobile nav */
    document.querySelectorAll(".sitem").forEach((el, i) => {
      el.addEventListener("click", () => goTo(i));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") goTo(i);
      });
    });
    document
      .querySelectorAll(".mnav-item")
      .forEach((el, i) => el.addEventListener("click", () => goTo(i)));
    document
      .querySelectorAll("[data-nav]")
      .forEach((el) =>
        el.addEventListener("click", () => goTo(parseInt(el.dataset.nav, 10))),
      );

    /* Modal triggers */
    document.querySelectorAll("[data-modal]").forEach((el) => {
      el.addEventListener("click", () => openModal(el.dataset.modal));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") openModal(el.dataset.modal);
      });
    });

    /* Skill buttons */
    document
      .querySelectorAll("[data-skill]")
      .forEach((el) =>
        el.addEventListener("click", () => addSkill(el.dataset.skill)),
      );
    Object.keys(SKILL_MAP).forEach((type) => {
      const inp = $(SKILL_MAP[type].input);
      if (inp)
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addSkill(type);
          }
        });
    });

    /* Delegation: edit/delete entries + chip remove + enhance bullets */
    document.addEventListener("click", (e) => {
      const eb = e.target.closest("[data-edit-type]");
      if (eb) {
        openModal(eb.dataset.editType, parseInt(eb.dataset.editIdx, 10));
        return;
      }
      const db = e.target.closest("[data-del-arr]");
      if (db) {
        removeItem(
          db.dataset.delArr,
          parseInt(db.dataset.delIdx, 10),
          db.dataset.delType,
        );
        return;
      }
      const cb = e.target.closest("[data-remove-skill]");
      if (cb) {
        removeSkill(cb.dataset.removeSkill, parseInt(cb.dataset.removeIdx, 10));
        return;
      }
      const enh = e.target.closest("#enhanceBtn");
      if (enh) aiEnhanceBullets("mf_resp", "mf_achiev", enh);
    });

    /* Top bar */
    const apiBtn = $("apiKeyBtn");
    if (apiBtn) {
      apiBtn.addEventListener("click", openApiKeyModal);
      apiBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") openApiKeyModal();
      });
    }
    $("topScorePill")?.addEventListener("click", () => goTo(8));

    /* API key modal */
    $("apiKeyCloseBtn")?.addEventListener("click", closeApiKeyModal);
    $("apiKeyCancelBtn")?.addEventListener("click", closeApiKeyModal);
    $("apiKeySaveBtn")?.addEventListener("click", saveApiKey);
    $("groqKeyInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveApiKey();
    });
    $("apiKeyOverlay")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeApiKeyModal();
    });

    /* Entry modal */
    $("modalCloseBtn")?.addEventListener("click", closeModal);
    $("modalCancelBtn")?.addEventListener("click", closeModal);
    $("modalSaveBtn")?.addEventListener("click", saveModal);
    $("overlay")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    /* Tutorial */
    $("tutorialBtn")?.addEventListener("click", openTutorial);
    $("tutorialCloseBtn")?.addEventListener("click", closeTutorial);
    $("tutorialOverlay")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeTutorial();
    });

    /* Export data (JSON) */
    $("exportDataBtn")?.addEventListener("click", exportData);
    $("exportDataBtnMob")?.addEventListener("click", exportData);
    $("expDataCard")?.addEventListener("click", exportData);

    /* Mobile: generate + PDF shortcut */
    $("genBtnMob")?.addEventListener("click", generateCV);
    $("expPdfMob")?.addEventListener("click", exportPDF);

    /* Mobile: AI skill extract */
    $("aiSkillBtnMob")?.addEventListener("click", aiExtractSkills);

    /* Mobile: per-section clear buttons */
    [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => {
      $("clearDataBtnMob" + n)?.addEventListener("click", () =>
        clearSection(n),
      );
    });

    /* Clear data */
    $("clearDataBtn")?.addEventListener("click", clearAllData);

    /* AI buttons */
    $("kwBtn")?.addEventListener("click", aiExtractKeywords);
    $("aiSumBtn")?.addEventListener("click", aiSummary);
    $("aiSkillBtn")?.addEventListener("click", aiExtractSkills);
    $("genBtn")?.addEventListener("click", generateCV);
    $("genBtn2")?.addEventListener("click", generateCV);

    /* CV edit */
    $("editBtn")?.addEventListener("click", toggleEdit);
    $("saveEditBtn")?.addEventListener("click", saveEdit);
    $("cancelEditBtn")?.addEventListener("click", cancelEdit);
    $("polishBtn")?.addEventListener("click", aiPolishCV);

    /* Export */
    $("exportPdfBtn")?.addEventListener("click", exportPDF);
    $("exportRtfBtn")?.addEventListener("click", exportRtf);
    $("downloadTxtBtn")?.addEventListener("click", downloadTxt);
    $("exportHtmlBtn")?.addEventListener("click", exportHTML);
    $("copyCvBtn")?.addEventListener("click", copyCV);
    $("expPdfCard")?.addEventListener("click", exportPDF);
    $("expRtfCard")?.addEventListener("click", exportRtf);
    $("expTxtCard")?.addEventListener("click", downloadTxt);
    $("setKeyEmptyBtn")?.addEventListener("click", openApiKeyModal);

    /* Escape */
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if ($("tutorialOverlay")?.classList.contains("open")) {
        closeTutorial();
        return;
      }
      if ($("apiKeyOverlay")?.classList.contains("open")) {
        closeApiKeyModal();
        return;
      }
      if ($("overlay")?.classList.contains("open")) {
        closeModal();
        return;
      }
    });

    /* Auto-save */
    FIELD_IDS.forEach((id) => {
      const el = $(id);
      if (el) {
        el.addEventListener("input", debouncedSave);
        el.addEventListener("change", debouncedSave);
      }
    });
    ["targetRole", "industry", "fullName", "email", "summary"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", updateProgress);
    });

    /* Warn before unload — only when user has real data and hasn't triggered clear */
    window.addEventListener("beforeunload", (e) => {
      if (_suppressUnload) return;
      if (
        g("targetRole") ||
        g("fullName") ||
        data.experiences.length ||
        data.education.length ||
        cvGenerated
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ═══════════════════════════════════════
     INIT
  ═══════════════════════════════════════ */
  function init() {
    setupEventListeners();
    loadAllData();
    updateProgress();
    updateKeyUI();
    if (!localStorage.getItem("cvforge_visited")) {
      localStorage.setItem("cvforge_visited", "1");
      setTimeout(openTutorial, 800);
    }
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
