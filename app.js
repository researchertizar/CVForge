/* ═══════════════════════════════════════
   CVForge Pro — Complete Production App
   All functions fully implemented.
   Bug fixes: API key modal, all AI calls,
   data persistence, export, edit, score.
   ═══════════════════════════════════════ */

(function () {
  "use strict";

  /* ── CONSTANTS ── */
  const STORAGE_KEY = "cvforge_pro_data_v2";
  const GROQ_MODEL  = "llama-3.3-70b-versatile";
  const GROQ_API    = "https://api.groq.com/openai/v1/chat/completions";

  const GROQ_CV_SYSTEM = `You are a senior professional CV writer and ATS optimization specialist with 15+ years experience at top recruitment agencies. Your CVs score 90%+ on ATS systems: Workday, Taleo, iCIMS, Greenhouse, Lever.

ABSOLUTE RULES — never break these:
1. Section headers in ALL CAPS only (PROFESSIONAL SUMMARY, WORK EXPERIENCE, SKILLS, EDUCATION, CERTIFICATIONS, PROJECTS)
2. Bullet points use • only — never dashes, numbers, or asterisks
3. ZERO tables, columns, graphics, or multi-column formatting — ATS destroys these
4. Every experience bullet starts with a past-tense action verb
5. Quantified metrics in at least 60% of experience bullets
6. Embed exact keywords from job description verbatim throughout
7. Contact information at the absolute top
8. Standard order: Contact → Summary → Work Experience → Skills → Projects → Education → Certifications → Additional
9. Dates in consistent format (Month YYYY or YYYY)
10. No first-person pronouns (I, my, we, our)
11. Clean blank lines between sections for ATS parsing
12. No markdown symbols (#, **, __, []) anywhere — plain text only
13. Never fabricate specific numbers unless inferrable from context
14. Keywords from the JD must appear naturally throughout`;

  /* ── STATE ── */
  const data = {
    experiences:    [],
    projects:       [],
    education:      [],
    certifications: [],
    skills: { tech: [], tool: [], meth: [], soft: [], lang: [] },
    keywords:       [],
  };
  let currentPanel  = 0;
  let modalType     = "";
  let modalEditIdx  = -1;
  let cvGenerated   = false;
  let editMode      = false;
  let cvBackup      = "";
  let saveTimer     = null;
  let toastTimer    = null;

  /* ── FIELD IDS for auto-save ── */
  const FIELD_IDS = [
    "targetRole","industry","expLevel","country","cvFormat","jobDescription",
    "fullName","proTitle","email","phone","location","linkedin","github","portfolio",
    "yearsExp","specialization","topSkills","achievements","summary",
    "awards","volunteer","memberships",
  ];

  /* ── SKILL MAP ── */
  const SKILL_MAP = {
    tech: { input: "techInput", tags: "techTags" },
    tool: { input: "toolInput", tags: "toolTags" },
    meth: { input: "methInput", tags: "methTags" },
    soft: { input: "softInput", tags: "softTags" },
    lang: { input: "langInput", tags: "langTags" },
  };

  /* ── HELPERS ── */
  const $ = (id) => document.getElementById(id);

  function g(id) {
    const el = $(id);
    if (!el) return "";
    return (el.value || "").trim();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(str) {
    return String(str || "").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function safeStr(v) {
    return String(v || "").trim();
  }

  function extractJSON(raw) {
    /* Strip markdown code fences if present */
    const clean = raw.replace(/```json|```/gi, "").trim();
    try { return JSON.parse(clean); } catch (_) {}
    /* Try extracting first {...} or [...] block */
    const obj = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (obj) { try { return JSON.parse(obj[1]); } catch (_) {} }
    return null;
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function showToast(msg, type = "", dur = 2800) {
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
    if (loading) {
      b.innerHTML = '<span class="spinning">⟳</span> Working…';
    } else if (label !== undefined) {
      b.innerHTML = label;
    }
  }

  /* ── DRAFT INDICATOR ── */
  function showDraftSaved() {
    const d = $("draftIndicator");
    if (!d) return;
    d.classList.add("show");
    clearTimeout(d._t);
    d._t = setTimeout(() => d.classList.remove("show"), 2000);
  }

  /* ── PERSISTENCE ── */
  function saveAllData() {
    try {
      const snapshot = {
        fields: {},
        data: {
          experiences:    data.experiences,
          projects:       data.projects,
          education:      data.education,
          certifications: data.certifications,
          skills:         data.skills,
          keywords:       data.keywords,
        },
        cvGenerated,
        currentPanel,
      };
      FIELD_IDS.forEach((id) => {
        const el = $(id);
        if (el) snapshot.fields[id] = el.value;
      });
      /* CV output text */
      const cvOut = $("cvOutput");
      if (cvOut) snapshot.cvText = cvOut.textContent || "";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      showDraftSaved();
    } catch (e) {
      console.warn("Save failed:", e);
    }
  }

  function loadAllData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      /* Restore fields */
      if (snap.fields) {
        Object.entries(snap.fields).forEach(([id, val]) => {
          const el = $(id);
          if (el) el.value = val;
        });
      }
      /* Restore arrays */
      if (snap.data) {
        const d = snap.data;
        if (Array.isArray(d.experiences))    data.experiences    = d.experiences;
        if (Array.isArray(d.projects))       data.projects       = d.projects;
        if (Array.isArray(d.education))      data.education      = d.education;
        if (Array.isArray(d.certifications)) data.certifications = d.certifications;
        if (d.skills) {
          ["tech","tool","meth","soft","lang"].forEach((k) => {
            if (Array.isArray(d.skills[k])) data.skills[k] = d.skills[k];
          });
        }
        if (Array.isArray(d.keywords)) data.keywords = d.keywords;
      }
      /* Restore CV text */
      if (snap.cvText) {
        const cvOut = $("cvOutput");
        if (cvOut) {
          cvOut.textContent = snap.cvText;
          cvOut.style.display = "block";
          $("cvEmptyState").style.display = "none";
          $("cvToolbar").style.display = "flex";
          const expCard = $("exportCard");
          if (expCard) expCard.style.display = "block";
          $("editBtn").style.display = "inline-flex";
          $("polishBtn").style.display = "inline-flex";
        }
      }
      cvGenerated = !!snap.cvGenerated;
      /* Render lists & tags */
      ["exp","proj","edu","cert"].forEach(renderList);
      Object.keys(SKILL_MAP).forEach(renderTags);
      /* Restore keywords */
      if (data.keywords.length) {
        $("kwGrid").innerHTML = data.keywords
          .map((k) => `<span class="kw kw-found">${escapeHtml(k)}</span>`).join("");
        $("kwResult").style.display = "block";
        $("kwAlert").className = "alert a-success show";
        $("kwAlert").textContent = `✓ ${data.keywords.length} ATS keywords loaded.`;
      }
    } catch (e) {
      console.warn("Load failed:", e);
    }
  }

  function clearAllData() {
    if (!confirm("Clear all your CV data? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  const debouncedSave = debounce(saveAllData, 800);

  /* ── API KEY ── */
  function getKey() {
    return localStorage.getItem("cvforge_groq_key") || "";
  }

  function updateKeyUI() {
    const k   = getKey();
    const btn = $("apiKeyBtn");
    const st  = $("apiKeyStatus");
    if (!btn || !st) return;
    if (k) {
      st.textContent       = "Key Active ✓";
      btn.style.borderColor = "rgba(34,211,160,.35)";
      btn.style.color       = "var(--green)";
    } else {
      st.textContent       = "Set Groq Key";
      btn.style.borderColor = "";
      btn.style.color       = "";
    }
  }

  function openApiKeyModal() {
    const overlay = $("apiKeyOverlay");
    if (!overlay) return;
    overlay.classList.add("open");
    const inp = $("groqKeyInput");
    if (inp) {
      const k = getKey();
      inp.value = k || "";
      inp.focus();
    }
    const errEl = $("apiKeyErr");
    if (errEl) errEl.className = "alert a-err";
  }

  function closeApiKeyModal() {
    const overlay = $("apiKeyOverlay");
    if (overlay) overlay.classList.remove("open");
  }

  function saveApiKey() {
    const inp = $("groqKeyInput");
    const errEl = $("apiKeyErr");
    if (!inp) return;
    const k = inp.value.trim();
    if (!k || !k.startsWith("gsk_")) {
      if (errEl) {
        errEl.className = "alert a-err show";
        errEl.textContent = "Key must start with gsk_ — copy it exactly from console.groq.com";
      }
      return;
    }
    localStorage.setItem("cvforge_groq_key", k);
    closeApiKeyModal();
    updateKeyUI();
    showToast("✓ Groq API key saved!", "success");
  }

  /* ── GROQ API ── */
  async function callGroq(userPrompt, systemPrompt, maxTokens) {
    const key = getKey();
    if (!key) {
      openApiKeyModal();
      throw new Error("Set your Groq API key first — click the 🔑 button");
    }
    const msgs = [];
    if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
    msgs.push({ role: "user", content: userPrompt });

    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + key,
      },
      body: JSON.stringify({
        model:      GROQ_MODEL,
        messages:   msgs,
        max_tokens: maxTokens || 4096,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      let errMsg = "Groq API error " + res.status;
      try {
        const errBody = await res.json();
        errMsg = errBody?.error?.message || errMsg;
      } catch (_) {}
      if (res.status === 401) errMsg = "Invalid Groq API key — re-enter at console.groq.com";
      if (res.status === 429) errMsg = "Rate limit reached — wait 30 seconds and try again";
      throw new Error(errMsg);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
  }

  /* ── NAVIGATION ── */
  function goTo(n) {
    if (n < 0 || n > 8) return;
    document.querySelectorAll(".panel").forEach((p, i) =>
      p.classList.toggle("active", i === n)
    );
    document.querySelectorAll(".sitem").forEach((s, i) =>
      s.classList.toggle("active", i === n)
    );
    document.querySelectorAll(".mnav-item").forEach((m, i) =>
      m.classList.toggle("active", i === n)
    );
    currentPanel = n;
    window.scrollTo({ top: 0, behavior: "smooth" });
    updateProgress();
    saveAllData();
  }

  /* ── PROGRESS ── */
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
      const si = $("sitem" + i);
      const mn = $("mn" + i);
      if (si) si.classList.toggle("done", ok);
      if (mn) mn.classList.toggle("done", ok);
      if (ok) done++;
    });
    const pct = Math.round((done / 8) * 100);
    const pctEl = $("sbPct");
    const barEl = $("sbBar");
    if (pctEl) pctEl.textContent = pct + "%";
    if (barEl) barEl.style.width = pct + "%";
  }

  /* ══════════════════════════════════════
     AI FEATURES
  ══════════════════════════════════════ */

  /* ── Extract Keywords ── */
  async function aiExtractKeywords() {
    const jd = g("jobDescription");
    if (!jd) { showToast("Paste a job description first"); return; }
    setBtnLoading("kwBtn", true);
    try {
      const res = await callGroq(
        `Extract the most important ATS keywords from this job description. Return ONLY a JSON array of strings — use verbatim phrases as they appear. No code blocks, no explanation:\n"${jd.slice(0, 4000)}"`,
        "You are an ATS keyword extraction specialist. Extract verbatim keyword phrases ATS systems scan for. Return only a valid JSON array of strings. Include technologies, tools, skills, qualifications, and role-specific terms."
      );
      const kws = extractJSON(res);
      const arr = Array.isArray(kws) ? kws : [];
      if (!arr.length) { showToast("No keywords parsed — try again", "error"); return; }
      data.keywords = arr;
      $("kwGrid").innerHTML = arr.map((k) => `<span class="kw kw-found">${escapeHtml(k)}</span>`).join("");
      $("kwResult").style.display = "block";
      $("kwAlert").className = "alert a-success show";
      $("kwAlert").textContent = `✓ ${arr.length} ATS keywords extracted — woven throughout your CV.`;
      showToast(`✓ ${arr.length} keywords extracted`, "success");
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("kwBtn", false, "✦ Extract Keywords");
  }

  /* ── Generate Summary ── */
  async function aiSummary() {
    const role   = g("targetRole");
    const yrs    = g("yearsExp");
    const spec   = g("specialization");
    const skills = g("topSkills");
    const ach    = g("achievements");
    const jd     = g("jobDescription");
    setBtnLoading("aiSumBtn", true);
    const al = $("sumAlert");
    if (al) { al.className = "alert a-info show"; al.textContent = "⟳ Groq is writing your summary…"; }
    try {
      const res = await callGroq(
        `Write a professional ATS-optimized CV summary:
Target Role: ${role || "Not specified"}
Years of Experience: ${yrs || "Not specified"}
Specialization: ${spec || "Not specified"}
Key Technologies/Skills: ${skills || "Not specified"}
Key Achievements: ${ach || "Not specified"}
${jd ? "Job Description Keywords to embed:\n" + jd.slice(0, 1500) : ""}

Requirements: 3-4 sentences, 60-90 words. Start with years of experience and role title. Pack with exact ATS keywords from the JD. Include 2-3 specific technologies. No first-person pronouns. No clichés like "results-driven" or "passionate".

Return ONLY the summary text, no labels, no quotes.`,
        "You are a senior CV writer and ATS specialist. You write keyword-dense, professionally compelling summaries that score 90%+ on ATS systems while engaging human recruiters. Every sentence carries specific value. Zero generic filler."
      );
      const summaryEl = $("summary");
      if (summaryEl) summaryEl.value = res.trim();
      if (al) { al.className = "alert a-success show"; al.textContent = "✓ Summary generated! Review and edit as needed."; }
      updateProgress();
      showToast("✓ Summary generated", "success");
      saveAllData();
    } catch (e) {
      if (al) { al.className = "alert a-err show"; al.textContent = "Error: " + e.message; }
      showToast(e.message, "error");
    }
    setBtnLoading("aiSumBtn", false, "✦ Generate with Groq");
  }

  /* ── Extract Skills from JD ── */
  async function aiExtractSkills() {
    const jd = g("jobDescription");
    if (!jd) { showToast("Go to Panel 1 and paste a job description first"); return; }
    setBtnLoading("aiSkillBtn", true);
    try {
      const res = await callGroq(
        `From this job description, extract skills into exactly this JSON structure:
{"tech":["..."],"tool":["..."],"meth":["..."]}
tech = programming languages, frameworks, libraries (verbatim names)
tool = software tools, platforms, cloud services
meth = methodologies, concepts, practices
JD: "${jd.slice(0, 4000)}"
Return ONLY valid JSON, no explanation, no code blocks.`,
        "You extract skills from job descriptions into structured JSON. Use verbatim names from the JD. Never paraphrase technology names — exact string matching is critical for ATS."
      );
      const parsed = extractJSON(res);
      if (!parsed) { showToast("Could not parse response — try again", "error"); return; }
      let added = 0;
      ["tech", "tool", "meth"].forEach((type) => {
        if (Array.isArray(parsed[type])) {
          parsed[type].forEach((s) => {
            if (s && !data.skills[type].includes(s)) { data.skills[type].push(s); added++; }
          });
          renderTags(type);
        }
      });
      showToast(`✓ ${added} skills extracted from job description`, "success");
      updateProgress();
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("aiSkillBtn", false, "✦ Extract from Job Description");
  }

  /* ── Enhance Bullets ── */
  async function aiEnhanceBullets(respId, achievId, btnEl) {
    const resp  = ($(respId)?.value  || "").trim();
    const achiev = ($(achievId)?.value || "").trim();
    const role  = g("targetRole");
    const techEl = $("mf_tech");
    const techVal = techEl ? techEl.value.trim() : "";
    if (!resp && !achiev) { showToast("Enter responsibilities or achievements first"); return; }
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<span class="spinning">⟳</span> Enhancing…'; }
    try {
      const res = await callGroq(
        `Rewrite as ATS-optimized CV bullet points:
Target Role: ${role || "Not specified"}
Technologies: ${techVal || "Not specified"}
RESPONSIBILITIES: ${resp || "None"}
ACHIEVEMENTS: ${achiev || "None"}

Rules:
- EVERY bullet starts with a strong past-tense action verb
- Include specific metrics in 60%+ of bullets
- Use exact technology names verbatim
- Under 25 words per bullet
- Use • prefix

Return ONLY bullet points in two labeled sections:
RESPONSIBILITIES:
[bullets]

ACHIEVEMENTS:
[bullets]`,
        "You are an expert CV writer specializing in ATS optimization. You transform vague job descriptions into quantified, action-verb-led bullet points. Never use passive voice. Every bullet must start with a strong verb."
      );
      const parts = res.split(/ACHIEVEMENTS:/i);
      if ($(respId))   $(respId).value   = (parts[0] || "").replace(/RESPONSIBILITIES:/i, "").trim();
      if ($(achievId)) $(achievId).value = (parts[1] || "").trim();
      showToast("✓ Bullets enhanced with action verbs & metrics", "success");
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = "✦ AI Enhance Bullets"; }
  }

  /* ── AI Polish ── */
  async function aiPolishCV() {
    const out = $("cvOutput");
    const currentCV = out ? out.textContent : "";
    if (!currentCV.trim()) { showToast("Generate CV first"); return; }
    setBtnLoading("polishBtn", true);
    const jd = g("jobDescription");
    try {
      const improved = await callGroq(
        `Review and improve this CV for maximum ATS score and recruiter impact:
${jd ? "JD KEYWORDS:\n" + jd.slice(0, 1500) + "\n\n" : ""}
CURRENT CV:
${currentCV}

Instructions:
- Strengthen weak action verbs
- Add specificity where metrics are vague
- Ensure ALL section headers are in ALL CAPS
- Ensure all bullets start with action verbs
- Improve keyword density using JD terms
- Fix any formatting inconsistencies
- Keep all factual information exactly the same

Return the COMPLETE improved CV. Plain text only, no markdown, no explanation.`,
        GROQ_CV_SYSTEM
      );
      cvBackup = out.textContent;
      out.textContent = improved;
      showToast("✓ CV polished by Groq AI", "success");
      await runATSScore(improved);
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("polishBtn", false, "✦ AI Polish");
  }

  /* ══════════════════════════════════════
     GENERATE CV
  ══════════════════════════════════════ */
  async function generateCV() {
    const role = g("targetRole");
    if (!role) { goTo(0); showToast("Enter your target job title first"); return; }
    if (!getKey()) { openApiKeyModal(); return; }

    const cvOut     = $("cvOutput");
    const emptyState = $("cvEmptyState");
    const toolbar    = $("cvToolbar");
    const expCard    = $("exportCard");
    const aiBar      = $("aiStatusBar");
    const errEl      = $("genErr");

    emptyState.style.display = "none";
    cvOut.style.display      = "none";
    toolbar.style.display    = "none";
    if (expCard) expCard.style.display = "none";
    aiBar.style.display      = "flex";
    errEl.className          = "alert a-err";
    $("genBtn").disabled     = true;
    $("genBtn2").disabled    = true;
    $("scoreCard").style.display   = "none";
    $("kwGapCard").style.display   = "none";
    $("editBtn").style.display     = "none";
    $("polishBtn").style.display   = "none";
    $("editBadge").style.display   = "none";

    const statuses = [
      "Analyzing job description keywords…",
      "Crafting professional summary…",
      "Formatting experience bullets with action verbs…",
      "Optimizing skills section for ATS…",
      "Building complete CV structure…",
      "Running keyword density check…",
      "Finalizing recruiter-ready output…",
    ];
    let si = 0;
    const ticker = setInterval(() => {
      const el = $("aiStatusText");
      if (el) el.textContent = statuses[si % statuses.length];
      si++;
    }, 2400);

    try {
      const prompt = buildCVPrompt();
      const cv     = await callGroq(prompt, GROQ_CV_SYSTEM, 4096);
      clearInterval(ticker);

      aiBar.style.display  = "none";
      cvOut.textContent    = cv;
      cvOut.contentEditable = "false";
      cvOut.style.display  = "block";
      toolbar.style.display = "flex";
      if (expCard) expCard.style.display = "block";
      $("editBtn").style.display   = "inline-flex";
      $("polishBtn").style.display = "inline-flex";
      cvGenerated = true;
      cvBackup    = cv;
      updateProgress();
      showToast("✓ ATS CV generated!", "success");
      await runATSScore(cv);
      saveAllData();
    } catch (e) {
      clearInterval(ticker);
      aiBar.style.display     = "none";
      emptyState.style.display = "flex";
      errEl.className  = "alert a-err show";
      errEl.textContent = "✗ " + e.message;
      showToast(e.message, "error");
    }
    $("genBtn").disabled  = false;
    $("genBtn2").disabled = false;
  }

  function buildCVPrompt() {
    const role     = g("targetRole");
    const industry = g("industry");
    const level    = g("expLevel");
    const country  = g("country");
    const format   = g("cvFormat");
    const jd       = g("jobDescription");
    const name     = g("fullName");
    const title    = g("proTitle");
    const email    = g("email");
    const phone    = g("phone");
    const loc      = g("location");
    const linkedin = g("linkedin");
    const github   = g("github");
    const portfolio = g("portfolio");
    const yrs      = g("yearsExp");
    const spec     = g("specialization");
    const topsk    = g("topSkills");
    const ach      = g("achievements");
    const summary  = g("summary");

    const expStr = data.experiences.map((e) =>
      `${e.title} at ${e.company} (${e.start}–${e.end || "Present"}) | ${e.etype || ""} | ${e.loc || ""}
Tech: ${e.tech || "N/A"}
Responsibilities: ${e.resp || "N/A"}
Achievements: ${e.achiev || "N/A"}`
    ).join("\n\n");

    const projStr = data.projects.map((p) =>
      `${p.name} | Role: ${p.role || ""} | Tech: ${p.tech || ""}
${p.desc || ""} | Impact: ${p.impact || ""} | URL: ${p.url || ""}`
    ).join("\n\n");

    const eduStr = data.education.map((e) =>
      `${e.degree} — ${e.institution} (${e.year || ""}) | ${e.cgpa || ""} | Coursework: ${e.coursework || ""}`
    ).join("\n");

    const certStr = data.certifications.map((c) =>
      `${c.name} | ${c.org || ""} | ${c.date || ""}`
    ).join("\n");

    const awards      = g("awards");
    const volunteer   = g("volunteer");
    const memberships = g("memberships");

    return `Generate a COMPLETE, professionally formatted ATS-optimized CV in ${format || "Chronological"} format targeting: "${role}"

=== TARGET ===
Role: ${role}
Industry: ${industry || "Not specified"}
Level: ${level || "Not specified"}
Country: ${country || "Not specified"}
${jd ? `\n=== JOB DESCRIPTION (embed ALL keywords verbatim throughout the CV) ===\n${jd.slice(0, 3500)}\n` : ""}
=== CANDIDATE ===
Name: ${name || "[Full Name]"}
Title: ${title || role}
Email: ${email || "[email@example.com]"}
Phone: ${phone || ""}
Location: ${loc || ""}
LinkedIn: ${linkedin || ""}
GitHub: ${github || ""}
Portfolio: ${portfolio || ""}

=== PROFESSIONAL SUMMARY ===
${summary || `${yrs ? yrs + " years of experience in " : ""}${spec || ""} ${topsk || ""}`}

=== KEY ACHIEVEMENTS (weave into experience bullets) ===
${ach || "Not provided"}

=== WORK EXPERIENCE ===
${expStr || `No entries — generate 2 realistic placeholder experience entries appropriate for a ${role} at ${level || "mid-level"} in ${industry || "the relevant industry"}`}

=== SKILLS ===
Technical: ${data.skills.tech.join(", ") || "Not added"}
Tools & Platforms: ${data.skills.tool.join(", ") || "Not added"}
Methodologies: ${data.skills.meth.join(", ") || "Not added"}
Soft Skills: ${data.skills.soft.join(", ") || "Not added"}
Languages: ${data.skills.lang.join(", ") || "Not added"}

=== PROJECTS ===
${projStr || "No projects added"}

=== EDUCATION ===
${eduStr || "No education added"}

=== CERTIFICATIONS ===
${certStr || "No certifications added"}
${awards ? "\n=== AWARDS ===\n" + awards : ""}${volunteer ? "\n=== VOLUNTEER ===\n" + volunteer : ""}${memberships ? "\n=== MEMBERSHIPS ===\n" + memberships : ""}

Generate the COMPLETE, recruitment-ready CV. For any section with insufficient data, generate realistic profession-appropriate content for a "${role}" in "${industry || "the relevant industry"}". Every bullet must start with an action verb. Include quantified metrics wherever plausible. Output plain text only.`;
  }

  /* ── ATS Score ── */
  async function runATSScore(cvText) {
    const jd = g("jobDescription");
    try {
      const res = await callGroq(
        `Score this CV. Return ONLY valid JSON, no markdown:\n{"score":<0-100>,"checks":[{"label":"Keywords matched","pass":true,"detail":""},{"label":"Action verbs used","pass":true,"detail":""},{"label":"Metrics & quantified results","pass":false,"detail":""},{"label":"ATS-parseable format","pass":true,"detail":""},{"label":"Contact info complete","pass":true,"detail":""},{"label":"Relevant experience","pass":true,"detail":""},{"label":"Skills section complete","pass":true,"detail":""},{"label":"Education present","pass":true,"detail":""}],"found_keywords":["..."],"missing_keywords":["..."]}\nJD: ${jd ? jd.slice(0, 1200) : "No JD — score generically"}\nCV: ${cvText.slice(0, 3000)}`,
        "You are an ATS engine that scores CVs objectively. Analyze keyword density, formatting compliance, structure, and content quality. Return only valid JSON."
      );
      const p = extractJSON(res);
      if (!p || typeof p.score !== "number") return;

      $("scoreCard").style.display = "block";
      const sv = $("scoreVal");
      sv.textContent = p.score;
      sv.className = "score-val " + (p.score >= 75 ? "high" : p.score >= 50 ? "mid" : "low");
      $("scoreFill").style.width = p.score + "%";

      const topPill = $("topScorePill");
      const topVal  = $("topScoreVal");
      if (topPill) topPill.style.display = "flex";
      if (topVal)  topVal.textContent    = p.score;

      if (p.checks) {
        $("scoreItems").innerHTML = p.checks
          .map((c) => `<div class="score-item ${c.pass ? "pass" : "fail"}">${c.pass ? "✓" : "✗"} ${escapeHtml(c.label)}${c.detail ? " — " + escapeHtml(c.detail) : ""}</div>`)
          .join("");
      }
      const found   = p.found_keywords   || [];
      const missing = p.missing_keywords || [];
      if (found.length || missing.length) {
        $("kwGapCard").style.display = "block";
        $("kwFound").innerHTML   = found.map((k) => `<span class="kw kw-found">${escapeHtml(k)}</span>`).join("");
        $("kwMissing").innerHTML = missing.map((k) => `<span class="kw kw-missing">${escapeHtml(k)}</span>`).join("");
      }
    } catch (_) { /* silent */ }
  }

  /* ══════════════════════════════════════
     INLINE EDIT
  ══════════════════════════════════════ */
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
      showToast("Edit mode — click text to modify. Click Done when finished.");
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
    if (out) { out.textContent = cvBackup; out.contentEditable = "false"; }
    editMode = false;
    $("editModeBar").classList.remove("show");
    $("editBadge").style.display = "none";
    $("editBtn").innerHTML = "✎ Edit CV";
    showToast("Changes discarded");
  }

  /* ══════════════════════════════════════
     EXPORT
  ══════════════════════════════════════ */
  function getCVText() {
    return ($("cvOutput")?.textContent || "").trim();
  }

  function copyCV() {
    const t = getCVText();
    if (!t) { showToast("Nothing to copy — generate first"); return; }
    navigator.clipboard.writeText(t).then(
      () => showToast("✓ CV copied to clipboard", "success"),
      () => showToast("Copy failed — try selecting text manually", "error")
    );
  }

  function downloadTxt() {
    const name = g("fullName") || "CV";
    const role = g("targetRole") || "Role";
    const blob = new Blob([getCVText()], { type: "text/plain" });
    triggerDownload(blob, `${slugify(name)}_${slugify(role)}_ATS_CV.txt`);
    showToast("✓ TXT downloaded", "success");
  }

  function exportHTML() {
    const cvText = getCVText();
    const name   = g("fullName") || "Candidate";
    const role   = g("targetRole") || "Professional";
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(name)} — ${escapeHtml(role)} CV</title><style>@page{margin:1.8cm 2cm}body{font-family:Arial,Helvetica,sans-serif;max-width:780px;margin:40px auto;padding:0 28px;color:#111;font-size:11pt;line-height:1.65}pre{white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.7;margin:0}@media print{body{margin:0;padding:20px;max-width:none}}</style></head><body><pre>${escapeHtml(cvText)}</pre></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    triggerDownload(blob, `${slugify(name)}_${slugify(role)}_CV.html`);
    showToast("✓ HTML downloaded — open in browser, print to PDF", "success");
  }

  function exportPDF() {
    const cvText = getCVText();
    const name   = g("fullName") || "Candidate";
    const role   = g("targetRole") || "Professional";
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(name)} — ${escapeHtml(role)} CV</title><style>@page{size:A4;margin:2cm}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10.5pt;line-height:1.7;margin:0;padding:0}pre{white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;line-height:1.7;margin:0;word-break:break-word}.hint{text-align:center;padding:16px;font-size:13px;color:#555;font-family:Arial;background:#f0f4ff;border-bottom:1px solid #cce;margin-bottom:20px}@media print{.hint{display:none}}</style></head><body><div class="hint"><strong>Ctrl+P</strong> (or Cmd+P on Mac) → Destination: <strong>"Save as PDF"</strong> → Margins: <strong>Default</strong> → Save</div><pre>${escapeHtml(cvText)}</pre></body></html>`;
    const w = window.open("", "_blank");
    if (!w) { showToast("Allow popups to use PDF export", "error"); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  function exportRtf() {
    const cvText = getCVText();
    const name   = g("fullName") || "Candidate";
    const role   = g("targetRole") || "Professional";
    const lines  = cvText.split("\n");
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
        !line.trim().startsWith("•") &&
        !line.trim().startsWith("\\u2022");
      if (isCaps) {
        body += `\\pard\\sb240\\sa80\\b\\fs24\\ul ${esc}\\ul0\\b0\\par\n`;
      } else if (line.trim().startsWith("•")) {
        body += `\\pard\\fi-240\\li360\\sa60 ${esc}\\par\n`;
      } else if (line.trim() === "") {
        body += `\\pard\\sa80\\par\n`;
      } else {
        body += `\\pard\\sa60 ${esc}\\par\n`;
      }
    });
    const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\n{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}\n{\\info{\\title ${escapeAttr(name)} — ${escapeAttr(role)} CV}}\n\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\n\\f1\\fs22\\sl276\\slmult1\n${body}\n}`;
    const blob = new Blob([rtf], { type: "application/rtf" });
    triggerDownload(blob, `${slugify(name)}_${slugify(role)}_ATS_CV.rtf`);
    showToast("✓ Word-compatible RTF downloaded. Open in Microsoft Word or Google Docs.", "success");
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

  function slugify(str) {
    return String(str).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40);
  }

  /* ══════════════════════════════════════
     ENTRY MODAL
  ══════════════════════════════════════ */
  function openModal(type, idx) {
    modalType    = type;
    modalEditIdx = (idx !== undefined && idx !== null) ? Number(idx) : -1;
    const titles = { exp: "Work Experience", proj: "Project", edu: "Education", cert: "Certification" };
    const titleEl = $("modalTitle");
    if (titleEl) titleEl.textContent = (modalEditIdx >= 0 ? "Edit " : "Add ") + (titles[type] || "Entry");
    const bodyEl = $("modalBody");
    if (bodyEl) bodyEl.innerHTML = buildModalFields(type, modalEditIdx);
    const overlay = $("overlay");
    if (overlay) overlay.classList.add("open");
    setTimeout(() => {
      const first = document.querySelector(".modal-body input, .modal-body textarea");
      if (first) first.focus();
    }, 100);
  }

  function buildModalFields(type, idx) {
    if (type === "exp") {
      const d = idx >= 0 ? (data.experiences[idx] || {}) : {};
      return `
<div class="g2">
  <div class="field"><label>Job Title<span class="req">*</span></label><input id="mf_title" value="${escapeAttr(d.title)}"></div>
  <div class="field"><label>Company<span class="req">*</span></label><input id="mf_company" value="${escapeAttr(d.company)}"></div>
</div>
<div class="g3">
  <div class="field"><label>Start Date</label><input id="mf_start" value="${escapeAttr(d.start)}" placeholder="Jan 2022"></div>
  <div class="field"><label>End Date</label><input id="mf_end" value="${escapeAttr(d.end)}" placeholder="Present"></div>
  <div class="field"><label>Type</label>
    <select id="mf_etype">
      <option value="">Select…</option>
      ${["Full-time","Part-time","Contract","Freelance","Internship"].map((o) => `<option value="${o}"${d.etype === o ? " selected" : ""}>${o}</option>`).join("")}
    </select>
  </div>
</div>
<div class="field"><label>Location / Remote</label><input id="mf_loc" value="${escapeAttr(d.loc)}" placeholder="London, UK / Remote"></div>
<div class="field"><label>Technologies &amp; Tools <span class="badge b-key" style="font-size:9px">ATS KEY</span></label><input id="mf_tech" value="${escapeAttr(d.tech)}" placeholder="Python, AWS, React.js, SQL — exact names for ATS"></div>
<div class="field"><label>Responsibilities</label><textarea id="mf_resp" style="min-height:90px">${escapeHtml(d.resp || "")}</textarea></div>
<div class="field"><label>Achievements with Metrics <span class="badge b-ai" style="font-size:9px">AI ENHANCE</span></label><textarea id="mf_achiev" style="min-height:80px" placeholder="• Increased sales by 32%&#10;• Led team of 8 engineers">${escapeHtml(d.achiev || "")}</textarea></div>
<button class="btn btn-ai btn-sm" style="margin-top:.25rem;align-self:flex-start" id="enhanceBtn">✦ AI Enhance Bullets</button>
<div class="tip-box" style="margin-top:.35rem"><span class="tip-icon">💡</span><span style="font-size:11px">Fill responsibilities &amp; achievements, then click AI Enhance to get ATS-optimized bullet points.</span></div>`;
    }
    if (type === "proj") {
      const d = idx >= 0 ? (data.projects[idx] || {}) : {};
      return `
<div class="field"><label>Project Name<span class="req">*</span></label><input id="mf_pname" value="${escapeAttr(d.name)}"></div>
<div class="field"><label>Technologies <span class="badge b-key" style="font-size:9px">ATS KEY</span></label><input id="mf_ptech" value="${escapeAttr(d.tech)}" placeholder="React.js, Node.js, MongoDB, AWS S3"></div>
<div class="g2">
  <div class="field"><label>Your Role</label><input id="mf_prole" value="${escapeAttr(d.role)}" placeholder="Lead Developer"></div>
  <div class="field"><label>GitHub / Live URL</label><input type="url" id="mf_purl" value="${escapeAttr(d.url)}"></div>
</div>
<div class="field"><label>Description</label><textarea id="mf_pdesc">${escapeHtml(d.desc || "")}</textarea></div>
<div class="field"><label>Results / Impact</label><input id="mf_pimp" value="${escapeAttr(d.impact)}" placeholder="500+ users, 30% performance improvement"></div>`;
    }
    if (type === "edu") {
      const d = idx >= 0 ? (data.education[idx] || {}) : {};
      return `
<div class="field"><label>Degree / Qualification<span class="req">*</span></label><input id="mf_deg" value="${escapeAttr(d.degree)}" placeholder="B.Sc. Computer Science"></div>
<div class="field"><label>Institution<span class="req">*</span></label><input id="mf_inst" value="${escapeAttr(d.institution)}"></div>
<div class="g3">
  <div class="field"><label>Graduation Year</label><input id="mf_year" value="${escapeAttr(d.year)}" placeholder="2023"></div>
  <div class="field"><label>Grade / CGPA</label><input id="mf_cgpa" value="${escapeAttr(d.cgpa)}" placeholder="3.8/4.0 or 2:1"></div>
  <div class="field"><label>Relevant Coursework</label><input id="mf_course" value="${escapeAttr(d.coursework)}" placeholder="ML, DSA, Databases"></div>
</div>`;
    }
    if (type === "cert") {
      const d = idx >= 0 ? (data.certifications[idx] || {}) : {};
      return `
<div class="field"><label>Certification Name<span class="req">*</span></label><input id="mf_cname" value="${escapeAttr(d.name)}"></div>
<div class="g2">
  <div class="field"><label>Issuing Organization</label><input id="mf_corg" value="${escapeAttr(d.org)}" placeholder="AWS, Google, Microsoft, PMI"></div>
  <div class="field"><label>Date Obtained</label><input id="mf_cdate" value="${escapeAttr(d.date)}" placeholder="Mar 2024"></div>
</div>
<div class="field"><label>Credential URL (optional)</label><input type="url" id="mf_curl" value="${escapeAttr(d.url)}"></div>`;
    }
    return "";
  }

  function closeModal() {
    const overlay = $("overlay");
    if (overlay) overlay.classList.remove("open");
  }

  function mv(id) {
    return ($(id)?.value || "").trim();
  }

  function saveModal() {
    if (modalType === "exp") {
      const o = {
        title:  mv("mf_title"),
        company: mv("mf_company"),
        start:  mv("mf_start"),
        end:    mv("mf_end"),
        etype:  mv("mf_etype"),
        loc:    mv("mf_loc"),
        tech:   mv("mf_tech"),
        resp:   mv("mf_resp"),
        achiev: mv("mf_achiev"),
      };
      if (!o.title || !o.company) { showToast("Job title and company are required"); return; }
      if (modalEditIdx >= 0) data.experiences[modalEditIdx] = o;
      else data.experiences.push(o);
      renderList("exp");
    } else if (modalType === "proj") {
      const o = { name: mv("mf_pname"), tech: mv("mf_ptech"), role: mv("mf_prole"), url: mv("mf_purl"), desc: mv("mf_pdesc"), impact: mv("mf_pimp") };
      if (!o.name) { showToast("Project name is required"); return; }
      if (modalEditIdx >= 0) data.projects[modalEditIdx] = o;
      else data.projects.push(o);
      renderList("proj");
    } else if (modalType === "edu") {
      const o = { degree: mv("mf_deg"), institution: mv("mf_inst"), year: mv("mf_year"), cgpa: mv("mf_cgpa"), coursework: mv("mf_course") };
      if (!o.degree || !o.institution) { showToast("Degree and institution are required"); return; }
      if (modalEditIdx >= 0) data.education[modalEditIdx] = o;
      else data.education.push(o);
      renderList("edu");
    } else if (modalType === "cert") {
      const o = { name: mv("mf_cname"), org: mv("mf_corg"), date: mv("mf_cdate"), url: mv("mf_curl") };
      if (!o.name) { showToast("Certification name is required"); return; }
      if (modalEditIdx >= 0) data.certifications[modalEditIdx] = o;
      else data.certifications.push(o);
      renderList("cert");
    }
    closeModal();
    updateProgress();
    saveAllData();
  }

  /* ── Render entry lists ── */
  function renderList(type) {
    const maps = {
      exp: {
        id:  "expList",
        arr: "experiences",
        fn:  (e) => `<div class="ecard-title">${escapeHtml(e.title)} — ${escapeHtml(e.company)}</div>
<div class="ecard-sub">${escapeHtml(e.start || "")}${e.end ? " – " + escapeHtml(e.end) : ""} · ${escapeHtml(e.etype || "")} ${e.loc ? "· " + escapeHtml(e.loc) : ""}</div>
${e.tech ? `<div class="etags">${e.tech.split(",").slice(0, 5).map((t) => `<span class="etag">${escapeHtml(t.trim())}</span>`).join("")}</div>` : ""}`,
      },
      proj: {
        id:  "projList",
        arr: "projects",
        fn:  (p) => `<div class="ecard-title">${escapeHtml(p.name)}</div>
<div class="ecard-sub">${escapeHtml(p.role || "")}${p.impact ? " · " + escapeHtml(p.impact) : ""}</div>
${p.tech ? `<div class="etags">${p.tech.split(",").slice(0, 4).map((t) => `<span class="etag">${escapeHtml(t.trim())}</span>`).join("")}</div>` : ""}`,
      },
      edu: {
        id:  "eduList",
        arr: "education",
        fn:  (e) => `<div class="ecard-title">${escapeHtml(e.degree)}</div>
<div class="ecard-sub">${escapeHtml(e.institution)}${e.year ? " · " + escapeHtml(e.year) : ""}${e.cgpa ? " · " + escapeHtml(e.cgpa) : ""}</div>`,
      },
      cert: {
        id:  "certList",
        arr: "certifications",
        fn:  (c) => `<div class="ecard-title">${escapeHtml(c.name)}</div>
<div class="ecard-sub">${escapeHtml(c.org || "")} · ${escapeHtml(c.date || "")}</div>`,
      },
    };
    const m   = maps[type];
    const el  = $(m.id);
    if (!el) return;
    el.innerHTML = data[m.arr].map((item, i) => `
<div class="ecard">
  <div class="ecard-body">${m.fn(item)}</div>
  <div class="ecard-actions">
    <button class="btn btn-ghost btn-icon btn-sm" data-edit-type="${type}" data-edit-idx="${i}" title="Edit" aria-label="Edit entry">✎</button>
    <button class="btn btn-danger btn-icon btn-sm" data-del-arr="${m.arr}" data-del-idx="${i}" data-del-type="${type}" title="Delete" aria-label="Delete entry">✕</button>
  </div>
</div>`).join("");
  }

  function removeItem(arr, i, type) {
    data[arr].splice(Number(i), 1);
    renderList(type);
    updateProgress();
    saveAllData();
  }

  /* ── SKILLS ── */
  function addSkill(type) {
    const map = SKILL_MAP[type];
    if (!map) return;
    const inp = $(map.input);
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    val.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => {
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
    el.innerHTML = data.skills[type].map((s, i) =>
      `<span class="chip">${escapeHtml(s)}<button class="chip-x" data-remove-skill="${type}" data-remove-idx="${i}" aria-label="Remove ${escapeAttr(s)}">×</button></span>`
    ).join("");
  }

  function removeSkill(type, i) {
    data.skills[type].splice(Number(i), 1);
    renderTags(type);
    saveAllData();
  }

  /* ── TUTORIAL ── */
  function openTutorial() {
    const el = $("tutorialOverlay");
    if (el) el.classList.add("open");
  }
  function closeTutorial() {
    const el = $("tutorialOverlay");
    if (el) el.classList.remove("open");
  }

  /* ══════════════════════════════════════
     EVENT LISTENERS
  ══════════════════════════════════════ */
  function setupEventListeners() {

    /* Sidebar navigation */
    document.querySelectorAll(".sitem").forEach((el, i) => {
      el.addEventListener("click", () => goTo(i));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") goTo(i); });
    });

    /* Mobile nav */
    document.querySelectorAll(".mnav-item").forEach((el, i) => {
      el.addEventListener("click", () => goTo(i));
    });

    /* data-nav buttons */
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => goTo(parseInt(el.dataset.nav, 10)));
    });

    /* data-modal triggers (add-entry divs) */
    document.querySelectorAll("[data-modal]").forEach((el) => {
      el.addEventListener("click",   () => openModal(el.dataset.modal));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openModal(el.dataset.modal); });
    });

    /* data-skill buttons */
    document.querySelectorAll("[data-skill]").forEach((el) => {
      el.addEventListener("click", () => addSkill(el.dataset.skill));
    });

    /* Skill input Enter */
    Object.keys(SKILL_MAP).forEach((type) => {
      const inp = $(SKILL_MAP[type].input);
      if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(type); } });
    });

    /* Edit/Delete delegation on mainArea */
    const main = $("mainArea");
    if (main) {
      main.addEventListener("click", (e) => {
        const editBtn = e.target.closest("[data-edit-type]");
        if (editBtn) openModal(editBtn.dataset.editType, parseInt(editBtn.dataset.editIdx, 10));
        const delBtn = e.target.closest("[data-del-arr]");
        if (delBtn) removeItem(delBtn.dataset.delArr, parseInt(delBtn.dataset.delIdx, 10), delBtn.dataset.delType);
      });
    }

    /* Remove skill delegation (chips rendered in skill tags) */
    document.addEventListener("click", (e) => {
      const chipBtn = e.target.closest("[data-remove-skill]");
      if (chipBtn) removeSkill(chipBtn.dataset.removeSkill, parseInt(chipBtn.dataset.removeIdx, 10));
      /* Enhance bullets button inside modal */
      const enhBtn = e.target.closest("#enhanceBtn");
      if (enhBtn) aiEnhanceBullets("mf_resp", "mf_achiev", enhBtn);
    });

    /* Top bar: API key button — THE PRIMARY FIX */
    const apiKeyBtn = $("apiKeyBtn");
    if (apiKeyBtn) {
      apiKeyBtn.addEventListener("click", openApiKeyModal);
      apiKeyBtn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openApiKeyModal(); });
    }

    /* Score pill */
    const scorePill = $("topScorePill");
    if (scorePill) scorePill.addEventListener("click", () => goTo(8));

    /* API key modal buttons */
    $("apiKeyCloseBtn")?.addEventListener("click",  closeApiKeyModal);
    $("apiKeyCancelBtn")?.addEventListener("click", closeApiKeyModal);
    $("apiKeySaveBtn")?.addEventListener("click",   saveApiKey);
    /* Enter key in API key input */
    $("groqKeyInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") saveApiKey(); });
    /* Overlay click to close */
    $("apiKeyOverlay")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeApiKeyModal(); });

    /* Entry modal buttons */
    $("modalCloseBtn")?.addEventListener("click",  closeModal);
    $("modalCancelBtn")?.addEventListener("click", closeModal);
    $("modalSaveBtn")?.addEventListener("click",   saveModal);
    $("overlay")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });

    /* Tutorial */
    $("tutorialBtn")?.addEventListener("click",       openTutorial);
    $("tutorialCloseBtn")?.addEventListener("click",  closeTutorial);
    $("tutorialOverlay")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeTutorial(); });

    /* Clear data */
    $("clearDataBtn")?.addEventListener("click", clearAllData);

    /* AI buttons */
    $("kwBtn")?.addEventListener("click",      aiExtractKeywords);
    $("aiSumBtn")?.addEventListener("click",   aiSummary);
    $("aiSkillBtn")?.addEventListener("click", aiExtractSkills);
    $("genBtn")?.addEventListener("click",     generateCV);
    $("genBtn2")?.addEventListener("click",    generateCV);

    /* CV Edit */
    $("editBtn")?.addEventListener("click",       toggleEdit);
    $("saveEditBtn")?.addEventListener("click",   saveEdit);
    $("cancelEditBtn")?.addEventListener("click", cancelEdit);

    /* AI Polish */
    $("polishBtn")?.addEventListener("click", aiPolishCV);

    /* Export toolbar */
    $("exportPdfBtn")?.addEventListener("click",  exportPDF);
    $("exportRtfBtn")?.addEventListener("click",  exportRtf);
    $("downloadTxtBtn")?.addEventListener("click", downloadTxt);
    $("exportHtmlBtn")?.addEventListener("click",  exportHTML);
    $("copyCvBtn")?.addEventListener("click",      copyCV);

    /* Export cards */
    $("expPdfCard")?.addEventListener("click",  exportPDF);
    $("expRtfCard")?.addEventListener("click",  exportRtf);
    $("expTxtCard")?.addEventListener("click",  downloadTxt);
    $("expHtmlCard")?.addEventListener("click", exportHTML);

    /* Empty state "Set API key" button */
    $("setKeyEmptyBtn")?.addEventListener("click", openApiKeyModal);

    /* Escape key: close modals */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ($("tutorialOverlay")?.classList.contains("open")) { closeTutorial(); return; }
        if ($("apiKeyOverlay")?.classList.contains("open"))   { closeApiKeyModal(); return; }
        if ($("overlay")?.classList.contains("open"))          { closeModal(); return; }
      }
    });

    /* Auto-save on field changes */
    FIELD_IDS.forEach((id) => {
      const el = $(id);
      if (el) {
        el.addEventListener("input",  debouncedSave);
        el.addEventListener("change", debouncedSave);
      }
    });

    /* Progress update on key fields */
    ["targetRole","industry","fullName","email","summary"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", updateProgress);
    });

    /* Before unload warning */
    window.addEventListener("beforeunload", (e) => {
      if (g("targetRole") || g("fullName") || g("summary") || data.experiences.length || data.education.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
