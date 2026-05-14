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
  const SYS_CV_WRITER = `You are an elite professional CV writer with 20 years of experience at top-tier recruitment agencies (Hays, Michael Page, Robert Half). You have personally placed 3,000+ candidates at FAANG, Fortune 500, NHS, and global consultancies. Your CVs consistently score above 90% on Applicant Tracking Systems including Workday, Taleo, iCIMS, Greenhouse, and Lever.

OUTPUT FORMAT — follow this EXACTLY, character by character:

1. CONTACT BLOCK (top of page):
   Full Name (line 1, standalone)
   Phone | Email | Location | LinkedIn | GitHub (line 2, pipe-separated)

2. SECTION HEADERS: ALL CAPS, followed by a blank line. Never use #, *, -, or markdown.

3. BULLETS: Always start with • (bullet character U+2022). NEVER use -, *, or numbers.

4. EXPERIENCE ENTRIES:
   Job Title | Company Name (line 1)
   Date Range | Employment Type | Location (line 2)
   • Bullet 1 (action verb + quantified result)
   • Bullet 2
   [blank line between entries]

5. SKILLS: Group by category label, colon, then comma-separated inline. Example:
   Backend: Python, Go, Django, FastAPI
   Databases: PostgreSQL, MySQL, MongoDB

6. PROJECTS:
   Project Name (bold-equivalent = standalone line)
   • Description with tech stack and impact

7. EDUCATION:
   Degree Name | Institution (line 1)
   Year Range (line 2)

8. CERTIFICATIONS: bullet list, each on own line

ABSOLUTE CONSTRAINTS — violation means failure:
✗ No tables, columns, or multi-column layout
✗ No markdown symbols: # ** __ [] () anywhere
✗ No first-person pronouns: I, my, me, we, our
✗ No clichés: results-driven, passionate, dynamic, hardworking, team player, go-getter
✗ No fabricated metrics — only use numbers the candidate provided or that are clearly inferrable
✗ No placeholder text like [Company Name] or [Year]
✗ Every experience bullet MUST start with a past-tense action verb
✗ Minimum 60% of bullets must contain a quantified result (%, number, dollar, time saved)
✗ Keywords from the job description MUST appear verbatim, naturally embedded
✗ Consistent date format: "Month YYYY" or "YYYY" — never mix formats
✗ Clean blank line between every major section
✗ Output is plain text only — immediately sendable, no post-processing needed`;

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
  const SYS_SUMMARY_WRITER = `You are a senior CV copywriter specializing in professional summaries. You write summaries that score top marks on ATS keyword density AND engage human recruiters.

Rules:
- 3–4 sentences, strictly 60–90 words
- Sentence 1: years of experience + role title + core specialization
- Sentence 2: top 2–3 specific technologies/tools (exact names from JD if provided)
- Sentence 3: key achievement or domain strength with specificity
- Sentence 4 (optional): value proposition or career goal aligned to the role
- NO first-person pronouns (I, my, me)
- NO clichés (passionate, results-driven, dynamic, hardworking)
- NO generic filler (seeking opportunities, looking for a role)
- Keywords from the job description embedded naturally
- Return ONLY the summary text — no labels, no quotes, no explanation`;

  /* Bullet enhancer */
  const SYS_BULLET_ENHANCER = `You are an ATS bullet point specialist. You transform weak job descriptions into powerful, quantified CV bullets that score maximum points on ATS and impress human recruiters.

Mandatory action verbs to choose from (use variety, never repeat in one section):
Architected, Automated, Built, Collaborated, Configured, Consolidated, Delivered, Deployed, Designed, Developed, Directed, Eliminated, Engineered, Enhanced, Established, Executed, Generated, Implemented, Integrated, Launched, Led, Maintained, Migrated, Modernized, Optimized, Orchestrated, Overhauled, Partnered, Pioneered, Reduced, Refactored, Released, Resolved, Scaled, Secured, Shipped, Spearheaded, Streamlined, Transitioned

Rules:
- EVERY bullet starts with one of the above verbs (past tense)
- 60%+ of bullets must contain a specific metric: %, $, number, or time
- Use exact technology names verbatim from the input
- Maximum 22 words per bullet — tight and punchy
- Prefix every bullet with • (U+2022 bullet character)
- Return two labeled sections exactly:
  RESPONSIBILITIES:
  [bullets]

  ACHIEVEMENTS:
  [bullets]
- No markdown, no extra explanation`;

  /* Polish system prompt */
  const SYS_POLISH = `You are a senior CV editor performing final quality review. You improve the CV without changing any factual content. Your job is surgical improvement only.

What to fix:
- Replace weak verbs with strong ones from: Architected, Automated, Delivered, Deployed, Engineered, Implemented, Launched, Optimized, Orchestrated, Reduced, Scaled, Spearheaded, Streamlined
- Add specificity where numbers are vague ("improved performance" → "improved API response time by 40%")
- Ensure all section headers are ALL CAPS
- Ensure every bullet starts with an action verb
- Improve keyword density by naturally embedding JD terms
- Fix inconsistent date formats
- Remove any remaining clichés or filler phrases
- Ensure clean blank lines between all sections

What NOT to change:
- Factual information (company names, dates, degrees, certifications)
- The candidate's actual technologies and projects
- Overall structure and section order

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
    "targetRole",
    "industry",
    "expLevel",
    "country",
    "cvFormat",
    "jobDescription",
    "fullName",
    "proTitle",
    "email",
    "phone",
    "location",
    "linkedin",
    "github",
    "portfolio",
    "yearsExp",
    "specialization",
    "topSkills",
    "achievements",
    "summary",
    "awards",
    "volunteer",
    "memberships",
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
    0: ["targetRole", "industry", "country", "jobDescription"],
    1: [
      "fullName",
      "proTitle",
      "email",
      "phone",
      "location",
      "linkedin",
      "github",
      "portfolio",
    ],
    2: ["yearsExp", "specialization", "topSkills", "achievements", "summary"],
    3: [],
    4: [],
    5: [],
    6: [],
    7: ["awards", "volunteer", "memberships"],
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
    const role = g("targetRole"),
      industry = g("industry"),
      level = g("expLevel");
    const country = g("country"),
      format = g("cvFormat"),
      jd = g("jobDescription");
    const name = g("fullName"),
      title = g("proTitle"),
      email = g("email");
    const phone = g("phone"),
      loc = g("location"),
      linkedin = g("linkedin");
    const github = g("github"),
      portfolio = g("portfolio");
    const yrs = g("yearsExp"),
      spec = g("specialization");
    const topsk = g("topSkills"),
      ach = g("achievements"),
      summary = g("summary");
    const awards = g("awards"),
      volunteer = g("volunteer"),
      memberships = g("memberships");

    const expStr = data.experiences.length
      ? data.experiences
          .map((e) =>
            [
              `ROLE: ${safeStr(e.title)} at ${safeStr(e.company)}`,
              `DATES: ${safeStr(e.start)} – ${safeStr(e.end) || "Present"} | TYPE: ${safeStr(e.etype)} | LOCATION: ${safeStr(e.loc)}`,
              `TECHNOLOGIES: ${safeStr(e.tech) || "Not specified"}`,
              `RESPONSIBILITIES: ${safeStr(e.resp) || "Not provided"}`,
              `ACHIEVEMENTS: ${safeStr(e.achiev) || "Not provided"}`,
            ].join("\n"),
          )
          .join("\n\n")
      : `NO ENTRIES PROVIDED — generate 2 realistic placeholder entries for a ${level || "mid-level"} ${role} in ${industry || "the relevant industry"}. Use plausible company names, technologies, and quantified achievements.`;

    const projStr = data.projects.length
      ? data.projects
          .map(
            (p) =>
              `PROJECT: ${safeStr(p.name)}\nROLE: ${safeStr(p.role)}\nTECH: ${safeStr(p.tech)}\nDESCRIPTION: ${safeStr(p.desc)}\nIMPACT: ${safeStr(p.impact)}\nURL: ${safeStr(p.url)}`,
          )
          .join("\n\n")
      : "No projects provided";

    const eduStr = data.education.length
      ? data.education
          .map(
            (e) =>
              `DEGREE: ${safeStr(e.degree)}\nINSTITUTION: ${safeStr(e.institution)}\nYEAR: ${safeStr(e.year)}\nGRADE: ${safeStr(e.cgpa)}\nCOURSEWORK: ${safeStr(e.coursework)}`,
          )
          .join("\n\n")
      : "No education provided";

    const certStr = data.certifications.length
      ? data.certifications
          .map(
            (c) =>
              `${safeStr(c.name)} | ${safeStr(c.org)} | ${safeStr(c.date)}`,
          )
          .join("\n")
      : "No certifications provided";

    return `Generate a complete, ATS-optimized professional CV.

━━━ TARGET ━━━
Job Title: ${role}
Industry: ${industry || "Not specified"}
Experience Level: ${level || "Not specified"}
Country/Region: ${country || "Not specified"}
CV Format: ${format || "Chronological"}
${jd ? `\n━━━ JOB DESCRIPTION (embed ALL keywords verbatim, naturally) ━━━\n${jd.slice(0, 3500)}\n` : ""}
━━━ CANDIDATE CONTACT ━━━
Full Name: ${name || "[Candidate Name]"}
Professional Title: ${title || role}
Email: ${email || "[email not provided]"}
Phone: ${phone || ""}
Location: ${loc || ""}
LinkedIn: ${linkedin || ""}
GitHub: ${github || ""}
Portfolio: ${portfolio || ""}

━━━ PROFESSIONAL SUMMARY (rewrite/enhance this, keeping all facts) ━━━
${summary || `${yrs ? yrs + " years of experience. " : ""}${spec ? "Specialised in " + spec + ". " : ""}${topsk ? "Technologies: " + topsk + "." : ""}`}

━━━ KEY ACHIEVEMENTS (weave into experience bullets, don't list separately) ━━━
${ach || "Not provided"}

━━━ WORK EXPERIENCE ━━━
${expStr}

━━━ TECHNICAL SKILLS ━━━
Technical: ${data.skills.tech.join(", ") || "Not provided"}
Tools & Platforms: ${data.skills.tool.join(", ") || "Not provided"}
Methodologies: ${data.skills.meth.join(", ") || "Not provided"}
Soft Skills: ${data.skills.soft.join(", ") || "Not provided"}
Languages: ${data.skills.lang.join(", ") || "Not provided"}

━━━ PROJECTS ━━━
${projStr}

━━━ EDUCATION ━━━
${eduStr}

━━━ CERTIFICATIONS ━━━
${certStr}
${awards ? "\n━━━ AWARDS & HONOURS ━━━\n" + awards : ""}
${volunteer ? "\n━━━ VOLUNTEER WORK ━━━\n" + volunteer : ""}
${memberships ? "\n━━━ MEMBERSHIPS ━━━\n" + memberships : ""}

━━━ INSTRUCTIONS ━━━
- Follow the output format in your system prompt EXACTLY
- Embed all extracted keywords from the job description naturally throughout
- For any section with "Not provided" data, generate realistic content appropriate for the role and level
- Every experience bullet must start with a strong past-tense action verb
- At least 60% of bullets must include a quantified result
- Output plain text only — no markdown, no HTML, no explanation`;
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

  function exportHTML() {
    const cvText = getCVText();
    const name = g("fullName") || "Candidate",
      role = g("targetRole") || "Professional";
    const html = buildPDFHtml(cvText, name, role, false);
    triggerDownload(
      new Blob([html], { type: "text/html" }),
      `${slugify(name)}_${slugify(role)}_CV.html`,
    );
    showToast("✓ HTML downloaded", "success");
  }

  /* ── PDF — renders Resume.pdf layout ─────────────────────
     Layout matches the uploaded Resume.pdf:
     • Name large + bold, centered
     • Contact icons row, centered, smaller
     • Section headers: uppercase, left-aligned, underlined
     • Experience: role bold left, date right (flex row)
     • Company italic, location right
     • Bullets: indented, tight line-height
     • Skills: category label bold + inline comma list
     • Clean typography: 10.5pt Calibri/Arial, 1.4 line-height
  ──────────────────────────────────────────────────────── */
  function buildPDFHtml(cvText, name, role, printHint = true) {
    const lines = cvText.split("\n");
    let html = "";
    let i = 0;

    /* Helper — detect ALL CAPS section headers */
    const isSectionHeader = (line) => {
      const t = line.trim();
      return (
        t.length > 2 &&
        t === t.toUpperCase() &&
        !/^[•\-\*]/.test(t) &&
        !/\d{4}/.test(t)
      );
    };

    /* Detect contact line (contains @ or + or pipe) */
    const isContactLine = (line) => /[@|+]/.test(line) && line.length < 220;

    /* Parse name = first non-empty line */
    while (i < lines.length && !lines[i].trim()) i++;
    const candidateName = lines[i]
      ? escapeHtml(lines[i].trim())
      : escapeHtml(name);
    i++;

    /* Next line(s) = contact */
    let contactHtml = "";
    while (i < lines.length && (isContactLine(lines[i]) || !lines[i].trim())) {
      if (lines[i].trim()) {
        /* Split by | and render each part with subtle separator */
        const parts = lines[i]
          .trim()
          .split("|")
          .map((p) => escapeHtml(p.trim()))
          .filter(Boolean);
        contactHtml = parts.join(' <span class="sep">|</span> ');
      }
      i++;
      if (!isContactLine(lines[i] || "")) break;
    }

    html += `<div class="cv-name">${candidateName}</div>`;
    if (contactHtml) html += `<div class="cv-contact">${contactHtml}</div>`;
    html += `<div class="cv-name-rule"></div>`;

    /* Render rest of CV */
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        /* blank line — small spacer */
        html += `<div class="cv-spacer"></div>`;
        i++;
        continue;
      }

      if (isSectionHeader(trimmed)) {
        html += `<div class="cv-section-header">${escapeHtml(trimmed)}</div>`;
        i++;
        continue;
      }

      if (trimmed.startsWith("•")) {
        /* bullet */
        html += `<div class="cv-bullet"><span class="cv-bullet-dot">•</span><span class="cv-bullet-text">${escapeHtml(trimmed.slice(1).trim())}</span></div>`;
        i++;
        continue;
      }

      /* Detect "Role | Company" or "Role at Company" pattern */
      const isRoleLine =
        /\bat\b/.test(trimmed) ||
        (trimmed.includes("|") &&
          !/[@+]/.test(trimmed) &&
          !trimmed.startsWith("•"));
      /* Detect date range line: contains YYYY */
      const isDateLine = /\d{4}/.test(trimmed) && trimmed.length < 100;
      /* Detect skills label: "Backend: " or "Technical: " */
      const isSkillLabel = /^[A-Za-z\s&]+:\s/.test(trimmed) && !isDateLine;

      if (isSkillLabel) {
        const colonIdx = trimmed.indexOf(":");
        const label = trimmed.slice(0, colonIdx + 1);
        const val = trimmed.slice(colonIdx + 1).trim();
        html += `<div class="cv-skill-row"><span class="cv-skill-label">${escapeHtml(label)}</span> <span class="cv-skill-val">${escapeHtml(val)}</span></div>`;
        i++;
        continue;
      }

      if (isDateLine && trimmed.length < 80) {
        html += `<div class="cv-date-line">${escapeHtml(trimmed)}</div>`;
        i++;
        continue;
      }

      /* Check if next non-empty line is a date → this is an entry title */
      let nextNonEmpty = "";
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextNonEmpty = lines[j].trim();
          break;
        }
      }
      const nextIsDate = /\d{4}/.test(nextNonEmpty) && nextNonEmpty.length < 80;

      if (nextIsDate && !isDateLine) {
        /* Entry title line */
        html += `<div class="cv-entry-title">${escapeHtml(trimmed)}</div>`;
        i++;
        continue;
      }

      /* Default: paragraph line */
      html += `<div class="cv-para">${escapeHtml(trimmed)}</div>`;
      i++;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(name)} — ${escapeHtml(role)} CV</title>
<style>
/* ── Page setup matching Resume.pdf ── */
@page { size: A4; margin: 18mm 20mm 16mm 20mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 10.5pt; }
body {
  font-family: "Calibri", "Arial", "Helvetica Neue", sans-serif;
  color: #1a1a1a;
  line-height: 1.42;
  background: #fff;
  padding: 0;
}

/* ── Name block ── */
.cv-name {
  font-size: 22pt;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.04em;
  color: #111;
  margin-bottom: 5pt;
  text-transform: uppercase;
}
.cv-contact {
  text-align: center;
  font-size: 9pt;
  color: #333;
  margin-bottom: 6pt;
  letter-spacing: 0.01em;
}
.cv-contact .sep { color: #888; margin: 0 3px; }
.cv-name-rule {
  border-bottom: 1.5px solid #1a1a1a;
  margin-bottom: 9pt;
}

/* ── Section headers ── */
.cv-section-header {
  font-size: 10pt;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #111;
  border-bottom: 1px solid #888;
  padding-bottom: 2pt;
  margin-top: 10pt;
  margin-bottom: 5pt;
}

/* ── Entry title (Job Title | Company) ── */
.cv-entry-title {
  font-size: 10.5pt;
  font-weight: 700;
  color: #111;
  margin-top: 5pt;
  margin-bottom: 1pt;
}

/* ── Date / location line ── */
.cv-date-line {
  font-size: 9.5pt;
  color: #444;
  font-style: italic;
  margin-bottom: 3pt;
}

/* ── Bullets ── */
.cv-bullet {
  display: flex;
  align-items: flex-start;
  gap: 5pt;
  margin: 2pt 0 2pt 10pt;
  font-size: 10pt;
  line-height: 1.4;
}
.cv-bullet-dot {
  flex-shrink: 0;
  margin-top: 0.5pt;
  color: #222;
}
.cv-bullet-text { flex: 1; }

/* ── Skills ── */
.cv-skill-row {
  font-size: 10pt;
  margin: 2pt 0 2pt 0;
  line-height: 1.4;
}
.cv-skill-label { font-weight: 700; }
.cv-skill-val   { color: #1a1a1a; }

/* ── Paragraph ── */
.cv-para {
  font-size: 10pt;
  margin: 2pt 0;
  line-height: 1.42;
}

/* ── Spacers ── */
.cv-spacer { height: 4pt; }

/* ── Print hint (screen only) ── */
.print-hint {
  background: #f0f4ff;
  border-bottom: 1px solid #bed;
  text-align: center;
  padding: 12px;
  font-size: 12px;
  font-family: Arial, sans-serif;
  color: #334;
}
@media print {
  .print-hint { display: none; }
  .cv-section-header { break-after: avoid; }
  .cv-entry-title { break-after: avoid; }
}
</style>
</head>
<body>
${printHint ? `<div class="print-hint"><strong>Ctrl+P</strong> → Destination: <strong>Save as PDF</strong> → Paper: <strong>A4</strong> → Margins: <strong>Default</strong></div>` : ""}
<div class="cv-body">
${html}
</div>
</body>
</html>`;
  }

  function exportPDF() {
    const cvText = getCVText();
    if (!cvText) {
      showToast("Generate your CV first");
      return;
    }
    const name = g("fullName") || "Candidate",
      role = g("targetRole") || "Professional";
    const html = buildPDFHtml(cvText, name, role, true);
    const w = window.open("", "_blank");
    if (!w) {
      showToast("Allow popups to export PDF", "error");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 600);
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
    <input id="mf_title" value="${escapeAttr(d.title)}" placeholder="e.g. Backend Developer, Staff Nurse, Accountant">
    <div class="fhint">💬 Use the exact title from the job posting if possible.</div>
  </div>
  <div class="field">
    <label>Company / Organisation <span class="req">*</span></label>
    <input id="mf_company" value="${escapeAttr(d.company)}" placeholder="e.g. Infosys, Freelance, Self-Employed">
    <div class="fhint">💬 If freelancing, write "Freelance" or "Self-Employed".</div>
  </div>
</div>
<div class="g3">
  <div class="field">
    <label>Start Date</label>
    ${dateInput("mf_start", d.start, "Jan 2023")}
    <div class="fhint">💬 Pick from calendar or type e.g. "Jan 2023".</div>
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
      ${["Full-time", "Part-time", "Contract", "Freelance", "Internship"].map((o) => `<option value="${o}"${d.etype === o ? " selected" : ""}>${o}</option>`).join("")}
    </select>
    <div class="fhint">💬 Choose the type that matches how you were employed.</div>
  </div>
</div>
<div class="field">
  <label>Location / Remote</label>
  <input id="mf_loc" value="${escapeAttr(d.loc)}" placeholder="e.g. Kozhikode, India / Remote">
  <div class="fhint">💬 City and country, or write "Remote" if fully remote.</div>
</div>
<div class="field">
  <label>Technologies &amp; Tools Used <span class="badge b-key" style="font-size:9px">ATS Key</span></label>
  <input id="mf_tech" value="${escapeAttr(d.tech)}" placeholder="Python, Django, PostgreSQL, WebSockets, Docker…">
  <div class="fhint">💬 Use exact names — "PostgreSQL" not "Postgres". Separate with commas. These become skill tags on your CV.</div>
</div>
<div class="field">
  <label>What you did (Responsibilities)</label>
  <textarea id="mf_resp" style="min-height:85px" placeholder="Describe your main tasks and what you were responsible for.&#10;e.g.&#10;- Developed REST APIs for a client billing system&#10;- Managed PostgreSQL database design and migrations&#10;- Built real-time chat features using Django Channels">${escapeHtml(d.resp || "")}</textarea>
  <div class="fhint">💬 Write in plain language — the AI will rewrite these as strong CV bullets with action verbs.</div>
</div>
<div class="field">
  <label>Achievements &amp; Results <span class="badge b-ai" style="font-size:9px">AI will enhance</span></label>
  <textarea id="mf_achiev" style="min-height:75px" placeholder="What did you achieve or improve?&#10;e.g.&#10;- Reduced API response time by 40%&#10;- Delivered project 2 weeks ahead of schedule&#10;- System handled 500+ concurrent users">${escapeHtml(d.achiev || "")}</textarea>
  <div class="fhint">💬 Numbers matter — include percentages, counts, time saved. Even rough estimates are fine.</div>
</div>
<button class="btn btn-ai btn-sm" style="margin-top:.3rem;align-self:flex-start" id="enhanceBtn">✦ AI Enhance Bullets</button>
<div class="tip-box" style="margin-top:.4rem;font-size:11.5px"><span class="tip-icon">💡</span><span>Click "AI Enhance Bullets" to convert your notes above into strong ATS-optimized bullet points with action verbs and metrics.</span></div>`;
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
        title: mv("mf_title"),
        company: mv("mf_company"),
        start: mv("mf_start"),
        end: mv("mf_end"),
        etype: mv("mf_etype"),
        loc: mv("mf_loc"),
        tech: mv("mf_tech"),
        resp: mv("mf_resp"),
        achiev: mv("mf_achiev"),
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
