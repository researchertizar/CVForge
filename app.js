/* ═══════════════════════════════════════
   CVForge Pro — Production Application
   ═══════════════════════════════════════ */

(function () {
  "use strict";

  /* ═══ CONSTANTS ═══ */
  const STORAGE_KEY = "cvforge_pro_data_v2";
  const GROQ_MODEL = "llama-3.3-70b-versatile";
  const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
  const API_TIMEOUT_MS = 90000;
  const TOTAL_CHECKS = 9;

  const GROQ_CV_SYSTEM = `You are a senior professional CV writer and ATS optimization specialist. You have written CVs for Fortune 500 companies and top-tier candidates worldwide.

Your CVs score 90%+ on ATS systems: Workday, Taleo, iCIMS, Greenhouse, Lever, SmartRecruiters.

ABSOLUTE RULES — never break these:
1. Section headers in ALL CAPS only (PROFESSIONAL SUMMARY, WORK EXPERIENCE, SKILLS, EDUCATION, CERTIFICATIONS, PROJECTS)
2. Bullet points use • only — never dashes, never numbers, never asterisks
3. ZERO tables, columns, graphics, icons, or multi-column formatting — ATS destroys these
4. Every experience bullet starts with a past-tense action verb
5. Quantified metrics in at least 60% of experience bullets
6. Embed exact keywords from job description verbatim throughout
7. Contact information at the absolute top
8. Standard order: Contact → Summary → Work Experience → Skills → Projects → Education → Certifications → Additional Info
9. Dates in consistent format (Month YYYY or YYYY)
10. No first-person pronouns (I, my, we, our)
11. Clean blank lines between sections for ATS parsing
12. No markdown symbols (#, **, __, []) anywhere — plain text only
13. Professional and factual — never exaggerate, never fabricate specific numbers unless inferrable
14. Keywords from the JD must appear naturally throughout — not crammed awkwardly

Your output is immediately ready for professional job applications.`;

  /* ═══ STATE ═══ */
  const data = {
    experiences: [],
    projects: [],
    education: [],
    certifications: [],
    skills: { tech: [], tool: [], meth: [], soft: [], lang: [] },
    keywords: [],
  };
  let currentPanel = 0;
  let modalType = "";
  let modalEditIdx = -1;
  let cvGenerated = false;
  let editMode = false;
  let cvBackup = "";

  /* ═══ DOM REFERENCES ═══ */
  const $ = (id) => document.getElementById(id);

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

  /* ═══ UTILITY FUNCTIONS ═══ */

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function safeStr(str) {
    if (!str) return "";
    return String(str)
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${");
  }

  function extractJSON(str) {
    if (!str) throw new Error("Empty AI response");
    str = str
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    try {
      return JSON.parse(str);
    } catch (e) {
      /* continue */
    }
    const match = str.match(/[$${][\s\S]*[$$}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        /* continue */
      }
    }
    throw new Error("Could not parse JSON from AI response");
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function g(id) {
    return (document.getElementById(id)?.value || "").trim();
  }

  function showToast(msg, type, dur) {
    type = type || "";
    dur = dur || 2800;
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (type ? " " + type : "");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), dur);
  }

  function setBtnLoading(id, loading, label) {
    const b = $(id);
    if (!b) return;
    if (loading) {
      if (!b.dataset.origHtml) b.dataset.origHtml = b.innerHTML;
      b.disabled = true;
      b.innerHTML = '<span class="spinning">\u27F3</span> Working\u2026';
    } else {
      b.disabled = false;
      b.innerHTML = label || b.dataset.origHtml || b.innerHTML;
      delete b.dataset.origHtml;
    }
  }

  /* ═══ PERSISTENCE ═══ */

  function saveAllData() {
    try {
      const payload = {
        experiences: data.experiences,
        projects: data.projects,
        education: data.education,
        certifications: data.certifications,
        skills: data.skills,
        keywords: data.keywords,
        cvGenerated: cvGenerated,
        cvBackup: cvBackup,
        currentPanel: currentPanel,
        formFields: {},
      };
      FIELD_IDS.forEach((id) => {
        payload.formFields[id] = g(id);
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const ind = $("draftIndicator");
      if (ind) {
        ind.classList.add("show");
        clearTimeout(ind._t);
        ind._t = setTimeout(() => ind.classList.remove("show"), 2000);
      }
    } catch (e) {
      /* localStorage full or unavailable */
    }
  }

  const debouncedSave = debounce(saveAllData, 1500);

  function loadAllData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;

      if (Array.isArray(saved.experiences))
        data.experiences = saved.experiences;
      if (Array.isArray(saved.projects)) data.projects = saved.projects;
      if (Array.isArray(saved.education)) data.education = saved.education;
      if (Array.isArray(saved.certifications))
        data.certifications = saved.certifications;
      if (saved.skills && typeof saved.skills === "object") {
        ["tech", "tool", "meth", "soft", "lang"].forEach((t) => {
          if (Array.isArray(saved.skills[t])) data.skills[t] = saved.skills[t];
        });
      }
      if (Array.isArray(saved.keywords)) data.keywords = saved.keywords;
      cvGenerated = !!saved.cvGenerated;
      cvBackup = saved.cvBackup || "";
      if (
        typeof saved.currentPanel === "number" &&
        saved.currentPanel >= 0 &&
        saved.currentPanel <= 8
      ) {
        currentPanel = saved.currentPanel;
      }

      const ff = saved.formFields || {};
      FIELD_IDS.forEach((id) => {
        const el = $(id);
        if (el && ff[id] !== undefined) el.value = ff[id];
      });

      ["exp", "proj", "edu", "cert"].forEach((t) => renderList(t));
      Object.keys(SKILL_MAP).forEach((t) => renderTags(t));

      if (data.keywords.length > 0) {
        $("kwGrid").innerHTML = data.keywords
          .map((k) => '<span class="kw kw-found">' + escapeHtml(k) + "</span>")
          .join("");
        $("kwResult").style.display = "block";
        $("kwAlert").className = "alert a-success show";
        $("kwAlert").textContent =
          "\u2713 " +
          data.keywords.length +
          " ATS keywords loaded from saved session.";
      }

      if (cvGenerated && cvBackup) {
        const out = $("cvOutput");
        out.textContent = cvBackup;
        out.contentEditable = "false";
        out.style.display = "block";
        $("cvEmptyState").style.display = "none";
        $("cvToolbar").style.display = "flex";
        $("exportCard").style.display = "block";
        $("editBtn").style.display = "inline-flex";
        $("polishBtn").style.display = "inline-flex";
      }

      goTo(currentPanel);
    } catch (e) {
      /* corrupted data */
    }
  }

  /* ═══ GROQ API KEY ═══ */

  function getKey() {
    return localStorage.getItem("cvforge_groq_key") || "";
  }

  function updateKeyUI() {
    const k = getKey();
    $("apiKeyStatus").textContent = k ? "Key Active \u2713" : "Set Groq Key";
    const btn = $("apiKeyBtn");
    btn.style.borderColor = k ? "rgba(34,211,160,.35)" : "";
    btn.style.color = k ? "var(--green)" : "";
  }

  function openApiKeyModal() {
    $("apiKeyOverlay").classList.add("open");
    const k = getKey();
    if (k) $("groqKeyInput").value = k;
    $("apiKeyErr").className = "alert a-err";
    setTimeout(() => $("groqKeyInput")?.focus(), 150);
  }

  function closeApiKeyModal() {
    $("apiKeyOverlay").classList.remove("open");
  }

  function saveApiKey() {
    const k = $("groqKeyInput").value.trim();
    if (!k || !k.startsWith("gsk_")) {
      const e = $("apiKeyErr");
      e.className = "alert a-err show";
      e.textContent =
        "Key must start with gsk_ \u2014 copy it exactly from console.groq.com";
      return;
    }
    localStorage.setItem("cvforge_groq_key", k);
    closeApiKeyModal();
    updateKeyUI();
    showToast("\u2713 Groq API key saved!", "success");
  }

  /* ═══ GROQ API CALL ═══ */

  async function callGroq(userPrompt, systemPrompt, maxTokens) {
    systemPrompt = systemPrompt || "";
    maxTokens = maxTokens || 4096;
    const key = getKey();
    if (!key) {
      openApiKeyModal();
      throw new Error(
        "Set your Groq API key first (top-right \uD83D\uDD11 button)",
      );
    }

    const msgs = [];
    if (systemPrompt) msgs.push({ role: "system", content: systemPrompt });
    msgs.push({ role: "user", content: userPrompt });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
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
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        let errMsg = "Groq API error " + res.status;
        try {
          const errBody = await res.json();
          errMsg = errBody?.error?.message || errMsg;
        } catch (_) {
          /* not JSON */
        }
        if (res.status === 401)
          throw new Error("Invalid Groq API key. Re-enter at console.groq.com");
        if (res.status === 429)
          throw new Error("Rate limit reached. Wait 30 seconds and try again.");
        if (res.status === 413)
          throw new Error(
            "Input too large. Try shortening your job description.",
          );
        if (res.status >= 500)
          throw new Error("Groq server error. Please try again in a moment.");
        throw new Error(errMsg);
      }

      const d = await res.json();
      const content = d.choices?.[0]?.message?.content || "";
      if (!content.trim())
        throw new Error("Groq returned an empty response. Please try again.");
      return content;
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError")
        throw new Error(
          "Request timed out. Check your connection and try again.",
        );
      if (e instanceof TypeError && e.message.includes("fetch"))
        throw new Error(
          "Network error. Check your internet connection and try again.",
        );
      throw e;
    }
  }

  /* ═══ NAVIGATION ═══ */

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
    closeSidebar();
  }

  /* ═══ MOBILE SIDEBAR ═══ */

  function toggleSidebar() {
    const sb = $("sidebar");
    const ov = $("sidebarOverlay");
    const btn = $("sidebarToggle");
    const isOpen = sb.classList.toggle("mobile-open");
    ov.classList.toggle("show", isOpen);
    btn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeSidebar() {
    $("sidebar").classList.remove("mobile-open");
    $("sidebarOverlay").classList.remove("show");
    $("sidebarToggle").setAttribute("aria-expanded", "false");
  }

  /* ═══ PROGRESS ═══ */

  function updateProgress() {
    const checks = [
      () => !!(g("targetRole") && g("industry")),
      () => !!(g("fullName") && g("email")),
      () => !!g("summary"),
      () => data.experiences.length > 0,
      () =>
        data.skills.tech.length > 0 ||
        data.skills.tool.length > 0 ||
        data.skills.meth.length > 0,
      () => data.projects.length > 0,
      () => data.education.length > 0,
      () => data.certifications.length > 0,
      () => cvGenerated,
    ];
    let done = 0;
    checks.forEach((fn, i) => {
      const ok = fn();
      document.getElementById("sitem" + i)?.classList.toggle("done", ok);
      document.getElementById("mn" + i)?.classList.toggle("done", ok);
      if (ok) done++;
    });
    const pct = Math.round((done / TOTAL_CHECKS) * 100);
    $("sbPct").textContent = pct + "%";
    $("sbBar").style.width = pct + "%";
  }

  /* ═══ AI: EXTRACT KEYWORDS ═══ */

  async function aiExtractKeywords() {
    const jd = g("jobDescription");
    if (!jd) {
      showToast("Paste a job description first");
      return;
    }
    setBtnLoading("kwBtn", true);
    const kwAlert = $("kwAlert");
    kwAlert.className = "alert a-info show";
    kwAlert.textContent = "\u27F3 Extracting keywords\u2026";
    try {
      const res = await callGroq(
        'Extract the most important ATS keywords from this job description. Return ONLY a JSON array of strings \u2014 use verbatim phrases as they appear, no paraphrasing. No code blocks, no explanation:\n"' +
          jd.slice(0, 4000) +
          '"',
        "You are an ATS keyword extraction specialist. Extract verbatim keyword phrases ATS systems scan for. Return only a valid JSON array of strings. Include specific technologies, tools, skills, qualifications, and role-specific terms.",
        2048,
      );
      let kws = extractJSON(res);
      if (!Array.isArray(kws)) kws = [];
      kws = kws
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 60);
      data.keywords = kws;
      $("kwGrid").innerHTML = kws
        .map((k) => '<span class="kw kw-found">' + escapeHtml(k) + "</span>")
        .join("");
      $("kwResult").style.display = "block";
      kwAlert.className = "alert a-success show";
      kwAlert.textContent =
        "\u2713 " +
        kws.length +
        " ATS keywords extracted \u2014 these will be woven throughout your CV.";
      showToast("\u2713 " + kws.length + " keywords extracted", "success");
      saveAllData();
    } catch (e) {
      kwAlert.className = "alert a-err show";
      kwAlert.textContent = "Error: " + e.message;
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("kwBtn", false, "\u2726 Extract Keywords");
  }

  /* ═══ AI: SUMMARY ═══ */

  async function aiSummary() {
    const role = g("targetRole"),
      yrs = g("yearsExp"),
      spec = g("specialization"),
      skills = g("topSkills"),
      ach = g("achievements"),
      jd = g("jobDescription");
    setBtnLoading("aiSumBtn", true);
    const al = $("sumAlert");
    al.className = "alert a-info show";
    al.textContent = "\u27F3 Groq is writing your summary\u2026";
    try {
      const res = await callGroq(
        "Write a professional ATS-optimized CV summary:\nTarget Role: " +
          (role || "Not specified") +
          "\nYears of Experience: " +
          (yrs || "Not specified") +
          "\nSpecialization: " +
          (spec || "Not specified") +
          "\nKey Technologies/Skills: " +
          (skills || "Not specified") +
          "\nKey Achievements: " +
          (ach || "Not specified") +
          (jd
            ? "\nJob Description Keywords to embed:\n" + jd.slice(0, 1500)
            : "") +
          '\n\nRequirements: 3-4 sentences, 60-90 words. Start with years of experience and role title. Pack with exact ATS keywords from the JD. Include 2-3 specific technologies. End with value proposition. No first-person pronouns. No clich\u00E9s like "results-driven" or "passionate".\n\nReturn ONLY the summary text, no labels, no quotes.',
        "You are a senior CV writer and ATS specialist with 15+ years at top recruitment agencies. You write keyword-dense, professionally compelling summaries that score 90%+ on ATS systems (Workday, Taleo, iCIMS) while engaging human recruiters. Every sentence carries specific value. Zero generic filler phrases. Tailored to the exact role and industry.",
      );
      $("summary").value = res.trim();
      al.className = "alert a-success show";
      al.textContent =
        "\u2713 Summary generated! Review and edit to sound like you.";
      updateProgress();
      saveAllData();
      showToast("\u2713 Summary generated", "success");
    } catch (e) {
      al.className = "alert a-err show";
      al.textContent = "Error: " + e.message;
      showToast(e.message, "error");
    }
    setBtnLoading("aiSumBtn", false, "\u2726 Generate with Groq");
  }

  /* ═══ AI: EXTRACT SKILLS ═══ */

  async function aiExtractSkills() {
    const jd = g("jobDescription");
    if (!jd) {
      showToast("Go to Panel 1 and paste a job description first");
      return;
    }
    setBtnLoading("aiSkillBtn", true);
    try {
      const res = await callGroq(
        'From this job description, extract skills into exactly this JSON structure:\n{"tech":["..."],"tool":["..."],"meth":["..."]}\ntech = programming languages, frameworks, libraries (verbatim names)\ntool = software tools, platforms, cloud services\nmeth = methodologies, concepts, practices\nJD: "' +
          jd.slice(0, 4000) +
          '"\nReturn ONLY valid JSON, no explanation, no code blocks. Use exact names as they appear.',
        "You extract skills from job descriptions into structured JSON. Use verbatim names from the JD. Never paraphrase technology names \u2014 exact string matching is critical for ATS.",
        2048,
      );
      let parsed = extractJSON(res);
      let added = 0;
      ["tech", "tool", "meth"].forEach((type) => {
        if (Array.isArray(parsed[type])) {
          parsed[type].forEach((s) => {
            const clean = String(s).trim();
            if (clean && !data.skills[type].includes(clean)) {
              data.skills[type].push(clean);
              added++;
            }
          });
        }
        renderTags(type);
      });
      showToast(
        "\u2713 " + added + " skills extracted from job description",
        "success",
      );
      updateProgress();
      saveAllData();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("aiSkillBtn", false, "\u2726 Extract from Job Description");
  }

  /* ═══ AI: ENHANCE BULLETS ═══ */

  async function aiEnhanceBullets(respId, achievId, btnEl) {
    const resp = (document.getElementById(respId)?.value || "").trim();
    const achiev = (document.getElementById(achievId)?.value || "").trim();
    const role = g("targetRole");
    const techVal = (document.getElementById("mf_tech")?.value || "").trim();

    if (!resp && !achiev) {
      showToast("Enter responsibilities or achievements first");
      return;
    }

    if (btnEl) {
      if (!btnEl.dataset.origHtml) btnEl.dataset.origHtml = btnEl.innerHTML;
      btnEl.disabled = true;
      btnEl.innerHTML = '<span class="spinning">\u27F3</span> Enhancing\u2026';
    }

    try {
      const res = await callGroq(
        "Rewrite as ATS-optimized CV bullet points:\nTarget Role: " +
          (role || "Not specified") +
          "\nTechnologies: " +
          (techVal || "Not specified") +
          "\nRESPONSIBILITIES: " +
          (resp || "None") +
          "\nACHIEVEMENTS: " +
          (achiev || "None") +
          "\n\nRules:\n- EVERY bullet starts with a strong past-tense action verb\n- Include specific metrics in 60%+ of bullets\n- Use exact technology names verbatim\n- Under 25 words per bullet\n- Use \u2022 prefix\n\nReturn ONLY bullet points in two labeled sections:\nRESPONSIBILITIES:\n[bullets]\n\nACHIEVEMENTS:\n[bullets]",
        "You are an expert CV writer specializing in ATS optimization. You transform vague job descriptions into quantified, action-verb-led bullet points. Never use passive voice. Every bullet must start with a strong verb and include specificity.",
        2048,
      );
      const parts = res.split(/ACHIEVEMENTS:/i);
      if (parts[0])
        document.getElementById(respId).value = parts[0]
          .replace(/RESPONSIBILITIES:/i, "")
          .trim();
      if (parts[1]) document.getElementById(achievId).value = parts[1].trim();
      showToast(
        "\u2713 Bullets enhanced with action verbs & metrics",
        "success",
      );
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }

    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = btnEl.dataset.origHtml || "\u2726 AI Enhance Bullets";
      delete btnEl.dataset.origHtml;
    }
  }

  /* ═══ AI POLISH ═══ */

  async function aiPolishCV() {
    const out = $("cvOutput");
    const currentCV = out.textContent;
    if (!currentCV.trim()) {
      showToast("Generate CV first");
      return;
    }
    setBtnLoading("polishBtn", true);
    const jd = g("jobDescription");
    try {
      const improved = await callGroq(
        "Review and improve this CV for maximum ATS score and recruiter impact:\n" +
          (jd ? "JD KEYWORDS:\n" + jd.slice(0, 1500) + "\n\n" : "") +
          "\nCURRENT CV:\n" +
          currentCV +
          "\n\nInstructions:\n- Strengthen weak action verbs\n- Add specificity where metrics are vague\n- Ensure ALL section headers are in ALL CAPS\n- Ensure all bullets start with action verbs\n- Improve keyword density using JD terms\n- Fix any formatting inconsistencies\n- Keep all factual information exactly the same\n\nReturn the COMPLETE improved CV. Plain text only, no markdown, no explanation.",
        GROQ_CV_SYSTEM,
      );
      cvBackup = out.textContent;
      out.textContent = improved;
      showToast("\u2713 CV polished by Groq AI", "success");
      await runATSScore(improved);
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
    setBtnLoading("polishBtn", false, "\u2726 AI Polish");
  }

  /* ═══ GENERATE CV ═══ */

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

    $("cvEmptyState").style.display = "none";
    $("cvOutput").style.display = "none";
    $("cvToolbar").style.display = "none";
    $("exportCard").style.display = "none";
    $("aiStatusBar").style.display = "flex";
    $("genErr").className = "alert";
    $("genBtn").disabled = true;
    $("genBtn2").disabled = true;
    $("scoreCard").style.display = "none";
    $("kwGapCard").style.display = "none";
    $("editBtn").style.display = "none";
    $("polishBtn").style.display = "none";
    $("editBadge").style.display = "none";

    const statuses = [
      "Analyzing job description keywords\u2026",
      "Crafting professional summary\u2026",
      "Formatting experience bullets with action verbs\u2026",
      "Optimizing skills section for ATS\u2026",
      "Building complete CV structure\u2026",
      "Running keyword density check\u2026",
      "Finalizing recruiter-ready output\u2026",
    ];
    let si = 0;
    const ticker = setInterval(() => {
      $("aiStatusText").textContent = statuses[si % statuses.length];
      si++;
    }, 2400);

    try {
      const cv = await callGroq(buildCVPrompt(), GROQ_CV_SYSTEM, 4096);
      clearInterval(ticker);
      $("aiStatusBar").style.display = "none";
      const out = $("cvOutput");
      out.textContent = cv;
      out.contentEditable = "false";
      out.style.display = "block";
      $("cvToolbar").style.display = "flex";
      $("exportCard").style.display = "block";
      $("editBtn").style.display = "inline-flex";
      $("polishBtn").style.display = "inline-flex";
      cvGenerated = true;
      cvBackup = cv;
      updateProgress();
      saveAllData();
      await runATSScore(cv);
      showToast("\u2713 ATS CV generated!", "success");
    } catch (e) {
      clearInterval(ticker);
      $("aiStatusBar").style.display = "none";
      if (!cvGenerated) {
        $("cvEmptyState").style.display = "flex";
      } else {
        $("cvOutput").style.display = "block";
        $("cvToolbar").style.display = "flex";
        $("editBtn").style.display = "inline-flex";
        $("polishBtn").style.display = "inline-flex";
      }
      const err = $("genErr");
      err.className = "alert a-err show";
      err.textContent = "\u2717 " + e.message;
      showToast(e.message, "error");
    }
    $("genBtn").disabled = false;
    $("genBtn2").disabled = false;
  }

  function buildCVPrompt() {
    const role = g("targetRole"),
      industry = g("industry"),
      level = g("expLevel"),
      country = g("country"),
      format = g("cvFormat"),
      jd = g("jobDescription");
    const name = g("fullName"),
      title = g("proTitle"),
      email = g("email"),
      phone = g("phone"),
      loc = g("location"),
      linkedin = g("linkedin"),
      github = g("github"),
      portfolio = g("portfolio");
    const yrs = g("yearsExp"),
      spec = g("specialization"),
      topsk = g("topSkills"),
      ach = g("achievements"),
      summary = g("summary");
    const awards = g("awards"),
      volunteer = g("volunteer"),
      memberships = g("memberships");

    const expStr = data.experiences
      .map(
        (e) =>
          safeStr(e.title) +
          " at " +
          safeStr(e.company) +
          " (" +
          safeStr(e.start) +
          "\u2013" +
          safeStr(e.end || "Present") +
          ") | " +
          safeStr(e.etype || "") +
          " | " +
          safeStr(e.loc || "") +
          "\nTech: " +
          safeStr(e.tech || "N/A") +
          "\nResponsibilities: " +
          safeStr(e.resp || "N/A") +
          "\nAchievements: " +
          safeStr(e.achiev || "N/A"),
      )
      .join("\n\n");

    const projStr = data.projects
      .map(
        (p) =>
          safeStr(p.name) +
          " | Role: " +
          safeStr(p.role || "") +
          " | Tech: " +
          safeStr(p.tech || "") +
          "\n" +
          safeStr(p.desc || "") +
          " | Impact: " +
          safeStr(p.impact || "") +
          " | URL: " +
          safeStr(p.url || ""),
      )
      .join("\n\n");

    const eduStr = data.education
      .map(
        (e) =>
          safeStr(e.degree) +
          " \u2014 " +
          safeStr(e.institution) +
          " (" +
          safeStr(e.year || "") +
          ") | " +
          safeStr(e.cgpa || "") +
          " | Coursework: " +
          safeStr(e.coursework || ""),
      )
      .join("\n");

    const certStr = data.certifications
      .map(
        (c) =>
          safeStr(c.name) +
          " | " +
          safeStr(c.org || "") +
          " | " +
          safeStr(c.date || ""),
      )
      .join("\n");

    return (
      "Generate a COMPLETE, professionally formatted ATS-optimized CV in " +
      format +
      ' format targeting: "' +
      safeStr(role) +
      '"' +
      "\n\n=== TARGET ===\nRole: " +
      safeStr(role) +
      "\nIndustry: " +
      safeStr(industry || "Not specified") +
      "\nLevel: " +
      safeStr(level || "Not specified") +
      "\nCountry: " +
      safeStr(country || "Not specified") +
      (jd
        ? "\n\n=== JOB DESCRIPTION (embed ALL keywords verbatim throughout the CV) ===\n" +
          jd.slice(0, 3500) +
          "\n"
        : "") +
      "\n\n=== CANDIDATE ===\nName: " +
      (name || "[Full Name]") +
      "\nTitle: " +
      (title || role) +
      "\nEmail: " +
      (email || "[email@example.com]") +
      "\nPhone: " +
      safeStr(phone || "") +
      "\nLocation: " +
      safeStr(loc || "") +
      "\nLinkedIn: " +
      safeStr(linkedin || "") +
      "\nGitHub: " +
      safeStr(github || "") +
      "\nPortfolio: " +
      safeStr(portfolio || "") +
      "\n\n=== PROFESSIONAL SUMMARY ===\n" +
      safeStr(
        summary ||
          (yrs ? yrs + " years of experience in " : "") +
            " " +
            (spec || "") +
            " " +
            (topsk || ""),
      ) +
      "\n\n=== KEY ACHIEVEMENTS (weave into experience bullets) ===\n" +
      safeStr(ach || "Not provided") +
      "\n\n=== WORK EXPERIENCE ===\n" +
      (expStr ||
        "No entries \u2014 generate 2 realistic placeholder experience entries appropriate for a " +
          safeStr(role) +
          " at " +
          safeStr(level || "mid-level") +
          " in " +
          safeStr(industry || "the relevant industry")) +
      "\n\n=== SKILLS ===\nTechnical: " +
      data.skills.tech.map(safeStr).join(", ") +
      "\nTools & Platforms: " +
      data.skills.tool.map(safeStr).join(", ") +
      "\nMethodologies: " +
      data.skills.meth.map(safeStr).join(", ") +
      "\nSoft Skills: " +
      data.skills.soft.map(safeStr).join(", ") +
      "\nLanguages: " +
      data.skills.lang.map(safeStr).join(", ") +
      "\n\n=== PROJECTS ===\n" +
      (projStr || "No projects added") +
      "\n\n=== EDUCATION ===\n" +
      (eduStr || "No education added") +
      "\n\n=== CERTIFICATIONS ===\n" +
      (certStr || "No certifications added") +
      (awards ? "\n\n=== AWARDS ===\n" + safeStr(awards) : "") +
      (volunteer ? "\n\n=== VOLUNTEER ===\n" + safeStr(volunteer) : "") +
      (memberships ? "\n\n=== MEMBERSHIPS ===\n" + safeStr(memberships) : "") +
      '\n\nGenerate the COMPLETE, recruitment-ready CV. For any section with insufficient data, generate realistic profession-appropriate content for a "' +
      safeStr(role) +
      '" in "' +
      safeStr(industry || "the relevant industry") +
      '". Every bullet must start with an action verb. Include quantified metrics wherever plausible. Output plain text only, ready to copy-paste.'
    );
  }

  /* ═══ ATS SCORE ═══ */

  async function runATSScore(cvText) {
    const jd = g("jobDescription");
    try {
      const res = await callGroq(
        'Score this CV. Return ONLY valid JSON, no markdown:\n{"score":<0-100>,"checks":[{"label":"Keywords matched","pass":true,"detail":""},{"label":"Action verbs used","pass":true,"detail":""},{"label":"Metrics & quantified results","pass":false,"detail":""},{"label":"ATS-parseable format","pass":true,"detail":""},{"label":"Contact info complete","pass":true,"detail":""},{"label":"Relevant experience","pass":true,"detail":""},{"label":"Skills section complete","pass":true,"detail":""},{"label":"Education present","pass":true,"detail":""}],"found_keywords":["..."],"missing_keywords":["..."]}\nJD: ' +
          (jd ? jd.slice(0, 1200) : "No JD \u2014 score generically") +
          "\nCV: " +
          cvText.slice(0, 3000),
        "You are an ATS engine that scores CVs objectively. Analyze keyword density, formatting compliance, structure, and content quality. Return only valid JSON.",
        2048,
      );
      let p = extractJSON(res);
      if (typeof p.score !== "number") return;

      $("scoreCard").style.display = "block";
      const sv = $("scoreVal");
      sv.textContent = Math.min(100, Math.max(0, p.score));
      sv.className =
        "score-val " + (p.score >= 75 ? "high" : p.score >= 50 ? "mid" : "low");
      $("scoreFill").style.width = Math.min(100, p.score) + "%";
      $("topScorePill").style.display = "flex";
      $("topScoreVal").textContent = p.score;

      if (Array.isArray(p.checks)) {
        $("scoreItems").innerHTML = p.checks
          .map(
            (c) =>
              '<div class="score-item ' +
              (c.pass ? "pass" : "fail") +
              '">' +
              (c.pass ? "\u2713" : "\u2717") +
              " " +
              escapeHtml(c.label) +
              (c.detail ? " \u2014 " + escapeHtml(c.detail) : "") +
              "</div>",
          )
          .join("");
      }

      const found = Array.isArray(p.found_keywords) ? p.found_keywords : [];
      const missing = Array.isArray(p.missing_keywords)
        ? p.missing_keywords
        : [];
      if (found.length + missing.length > 0) {
        $("kwGapCard").style.display = "block";
        $("kwFound").innerHTML = found
          .map((k) => '<span class="kw kw-found">' + escapeHtml(k) + "</span>")
          .join("");
        $("kwMissing").innerHTML = missing
          .map(
            (k) => '<span class="kw kw-missing">' + escapeHtml(k) + "</span>",
          )
          .join("");
      }
    } catch (e) {
      /* ATS scoring is non-critical; show a graceful fallback */
      $("scoreCard").style.display = "block";
      $("scoreVal").textContent = "\u2014";
      $("scoreVal").className = "score-val mid";
      $("scoreItems").innerHTML =
        '<div class="score-item fail">\u2717 Could not calculate score: ' +
        escapeHtml(e.message) +
        "</div>";
    }
  }

  /* ═══ INLINE EDIT ═══ */

  function toggleEdit() {
    const out = $("cvOutput");
    if (!editMode) {
      cvBackup = out.textContent;
      out.contentEditable = "true";
      out.focus();
      editMode = true;
      $("editModeBar").classList.add("show");
      $("editBadge").style.display = "inline-flex";
      $("editBtn").innerHTML = "\u270E Editing\u2026";
      showToast("Edit mode \u2014 click text to modify. Done when finished.");
    } else {
      saveEdit();
    }
  }

  function saveEdit() {
    $("cvOutput").contentEditable = "false";
    editMode = false;
    $("editModeBar").classList.remove("show");
    $("editBadge").style.display = "none";
    $("editBtn").innerHTML = "\u270E Edit CV";
    showToast("\u2713 Changes saved", "success");
  }

  function cancelEdit() {
    const out = $("cvOutput");
    out.textContent = cvBackup;
    out.contentEditable = "false";
    editMode = false;
    $("editModeBar").classList.remove("show");
    $("editBadge").style.display = "none";
    $("editBtn").innerHTML = "\u270E Edit CV";
    showToast("Changes discarded");
  }

  /* ═══ EXPORT FUNCTIONS ═══ */

  function getCVText() {
    return $("cvOutput").textContent || "";
  }

  function copyCV() {
    const text = getCVText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("\u2713 CV copied to clipboard", "success"))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("\u2713 CV copied to clipboard", "success");
    } catch (e) {
      showToast("Could not copy \u2014 select text manually", "error");
    }
  }

  function downloadTxt() {
    const name = g("fullName") || "CV";
    const role = g("targetRole") || "Role";
    const blob = new Blob([getCVText()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      name.replace(/\s+/g, "_") +
      "_" +
      role.replace(/\s+/g, "_") +
      "_ATS_CV.txt";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("\u2713 TXT downloaded", "success");
  }

  function exportHTML() {
    const cvText = getCVText();
    const name = g("fullName") || "Candidate";
    const role = g("targetRole") || "Professional";
    const html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>' +
      escapeHtml(name) +
      " \u2014 " +
      escapeHtml(role) +
      " CV</title><style>@page{margin:1.8cm 2cm}body{font-family:Arial,Helvetica,sans-serif;max-width:780px;margin:40px auto;padding:0 28px;color:#111;font-size:11pt;line-height:1.65}pre{white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.7;margin:0}@media print{body{margin:0;padding:20px;max-width:none}}</style></head><body><pre>" +
      escapeHtml(cvText) +
      "</pre></body></html>";
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      name.replace(/\s+/g, "_") + "_" + role.replace(/\s+/g, "_") + "_CV.html";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(
      "\u2713 HTML downloaded \u2014 open in browser, print to PDF",
      "success",
    );
  }

  function exportPDF() {
    const cvText = getCVText();
    const name = g("fullName") || "Candidate";
    const role = g("targetRole") || "Professional";
    const html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
      escapeHtml(name) +
      " \u2014 " +
      escapeHtml(role) +
      ' CV</title><style>@page{size:A4;margin:2cm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10.5pt;line-height:1.7;margin:0;padding:0}pre{white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;line-height:1.7;margin:0;word-break:break-word}.hint{text-align:center;padding:18px;font-size:13px;color:#666;font-family:Arial;background:#f0f4ff;border-bottom:1px solid #cce;margin-bottom:20px}@media print{.hint{display:none}}</style></head><body><div class="hint"><strong>Ctrl+P</strong> (or Cmd+P on Mac) \u2192 set Destination to <strong>"Save as PDF"</strong> \u2192 set Margins to <strong>Default</strong> \u2192 Save<br><em>This creates a clean, ATS-friendly PDF.</em></div><pre>' +
      escapeHtml(cvText) +
      "</pre></body></html>";
    const w = window.open("", "_blank");
    if (!w) {
      /* Fallback: download HTML for manual print */
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download =
        name.replace(/\s+/g, "_") +
        "_" +
        role.replace(/\s+/g, "_") +
        "_CV_print.html";
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(
        "Popup blocked \u2014 downloaded HTML. Open it and press Ctrl+P to save as PDF.",
        "error",
      );
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.print();
      } catch (e) {
        /* ignore */
      }
    }, 500);
  }

  function exportRtf() {
    const cvText = getCVText();
    const name = g("fullName") || "Candidate";
    const role = g("targetRole") || "Professional";
    const lines = cvText.split("\n");
    let body = "";
    lines.forEach((line) => {
      const esc = line
        .replace(/\\/g, "\\\\")
        .replace(/\{/g, "\\{")
        .replace(/\}/g, "\\}")
        .replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0) + "?");
      const trimmed = line.trim();
      const isCaps =
        trimmed &&
        trimmed === trimmed.toUpperCase() &&
        trimmed.length > 2 &&
        !trimmed.startsWith("\u2022") &&
        !trimmed.startsWith("\u2022");
      if (isCaps) {
        body += "\\pard\\sb240\\sa80\\b\\fs24\\ul " + esc + "\\ul0\\b0\\par\n";
      } else if (trimmed.startsWith("\u2022")) {
        body += "\\pard\\fi-240\\li360\\sa60 " + esc + "\\par\n";
      } else if (trimmed === "") {
        body += "\\pard\\sa80\\par\n";
      } else {
        body += "\\pard\\sa60 " + esc + "\\par\n";
      }
    });
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0\n{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}\n{\\info{\\title " +
      escapeHtml(name) +
      " \u2014 " +
      escapeHtml(role) +
      " CV}}\n\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\n\\f1\\fs22\\sl276\\slmult1\n" +
      body +
      "\n}";
    const blob = new Blob([rtf], { type: "application/rtf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      name.replace(/\s+/g, "_") +
      "_" +
      role.replace(/\s+/g, "_") +
      "_ATS_CV.rtf";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(
      "\u2713 RTF downloaded \u2014 opens in Microsoft Word or Google Docs.",
      "success",
    );
  }

  /* ═══ MODAL ═══ */

  function openModal(type, idx) {
    idx = idx !== undefined ? idx : -1;
    modalType = type;
    modalEditIdx = idx;
    const titles = {
      exp: "Work Experience",
      proj: "Project",
      edu: "Education",
      cert: "Certification",
    };
    $("modalTitle").textContent = (idx >= 0 ? "Edit " : "Add ") + titles[type];
    $("modalBody").innerHTML = buildModalFields(type, idx);
    $("overlay").classList.add("open");
    setTimeout(
      () =>
        document
          .querySelector(".modal-body input,.modal-body textarea")
          ?.focus(),
      100,
    );
  }

  function closeModal() {
    $("overlay").classList.remove("open");
  }

  function buildModalFields(type, idx) {
    if (type === "exp") {
      const d = idx >= 0 ? data.experiences[idx] : {};
      return (
        '<div class="g2"><div class="field"><label>Job Title<span class="req">*</span></label><input id="mf_title" value="' +
        escapeAttr(d.title || "") +
        '"></div><div class="field"><label>Company<span class="req">*</span></label><input id="mf_company" value="' +
        escapeAttr(d.company || "") +
        '"></div></div>' +
        '<div class="g3"><div class="field"><label>Start Date</label><input id="mf_start" value="' +
        escapeAttr(d.start || "") +
        '" placeholder="Jan 2022"></div><div class="field"><label>End Date</label><input id="mf_end" value="' +
        escapeAttr(d.end || "") +
        '" placeholder="Present"></div><div class="field"><label>Type</label><select id="mf_etype"><option value="">Select\u2026</option>' +
        ["Full-time", "Part-time", "Contract", "Freelance", "Internship"]
          .map(
            (o) =>
              '<option value="' +
              o +
              '"' +
              (d.etype === o ? " selected" : "") +
              ">" +
              o +
              "</option>",
          )
          .join("") +
        '</select></div></div><div class="field"><label>Location / Remote</label><input id="mf_loc" value="' +
        escapeAttr(d.loc || "") +
        '" placeholder="London, UK / Remote"></div>' +
        '<div class="field"><label>Technologies & Tools <span class="badge b-key">ATS KEY</span></label><input id="mf_tech" value="' +
        escapeAttr(d.tech || "") +
        '" placeholder="Python, AWS, React.js, SQL \u2014 exact names for ATS"></div>' +
        '<div class="field"><label>Responsibilities</label><textarea id="mf_resp" style="min-height:90px">' +
        escapeHtml(d.resp || "") +
        "</textarea></div>" +
        '<div class="field"><label>Achievements with Metrics <span class="badge b-ai">AI ENHANCE</span></label><textarea id="mf_achiev" style="min-height:80px" placeholder="\u2022 Increased sales by 32%&#10;\u2022 Led team of 8 engineers">' +
        escapeHtml(d.achiev || "") +
        "</textarea></div>" +
        '<button class="btn btn-ai btn-sm" id="enhanceBtn" style="margin-top:.25rem;align-self:flex-start">\u2726 AI Enhance Bullets</button>' +
        '<div class="tip-box" style="margin-top:.35rem"><span class="tip-icon">\uD83D\uDCA1</span><span style="font-size:11px">Fill responsibilities & achievements above, then click AI Enhance to get ATS-optimized bullet points.</span></div>'
      );
    }
    if (type === "proj") {
      const d = idx >= 0 ? data.projects[idx] : {};
      return (
        '<div class="field"><label>Project Name<span class="req">*</span></label><input id="mf_pname" value="' +
        escapeAttr(d.name || "") +
        '"></div>' +
        '<div class="field"><label>Technologies <span class="badge b-key">ATS KEY</span></label><input id="mf_ptech" value="' +
        escapeAttr(d.tech || "") +
        '" placeholder="React.js, Node.js, MongoDB, AWS S3"></div>' +
        '<div class="g2"><div class="field"><label>Your Role</label><input id="mf_prole" value="' +
        escapeAttr(d.role || "") +
        '" placeholder="Lead Developer"></div><div class="field"><label>GitHub / Live URL</label><input type="url" id="mf_purl" value="' +
        escapeAttr(d.url || "") +
        '"></div></div>' +
        '<div class="field"><label>Description</label><textarea id="mf_pdesc">' +
        escapeHtml(d.desc || "") +
        "</textarea></div>" +
        '<div class="field"><label>Results / Impact</label><input id="mf_pimp" value="' +
        escapeAttr(d.impact || "") +
        '" placeholder="500+ users, 30% performance improvement"></div>'
      );
    }
    if (type === "edu") {
      const d = idx >= 0 ? data.education[idx] : {};
      return (
        '<div class="field"><label>Degree / Qualification<span class="req">*</span></label><input id="mf_deg" value="' +
        escapeAttr(d.degree || "") +
        '" placeholder="B.Sc. Computer Science"></div>' +
        '<div class="field"><label>Institution<span class="req">*</span></label><input id="mf_inst" value="' +
        escapeAttr(d.institution || "") +
        '"></div>' +
        '<div class="g3"><div class="field"><label>Graduation Year</label><input id="mf_year" value="' +
        escapeAttr(d.year || "") +
        '" placeholder="2023"></div><div class="field"><label>Grade / CGPA</label><input id="mf_cgpa" value="' +
        escapeAttr(d.cgpa || "") +
        '" placeholder="3.8/4.0 or 2:1"></div><div class="field"><label>Relevant Coursework</label><input id="mf_course" value="' +
        escapeAttr(d.coursework || "") +
        '" placeholder="ML, DSA, Databases"></div></div>'
      );
    }
    if (type === "cert") {
      const d = idx >= 0 ? data.certifications[idx] : {};
      return (
        '<div class="field"><label>Certification Name<span class="req">*</span></label><input id="mf_cname" value="' +
        escapeAttr(d.name || "") +
        '"></div>' +
        '<div class="g2"><div class="field"><label>Issuing Organization</label><input id="mf_corg" value="' +
        escapeAttr(d.org || "") +
        '" placeholder="AWS, Google, Microsoft, PMI"></div><div class="field"><label>Date Obtained</label><input id="mf_cdate" value="' +
        escapeAttr(d.date || "") +
        '" placeholder="Mar 2024"></div></div>' +
        '<div class="field"><label>Credential URL (optional)</label><input type="url" id="mf_curl" value="' +
        escapeAttr(d.url || "") +
        '"></div>'
      );
    }
    return "";
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
        showToast("Job title and company are required");
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
        showToast("Project name is required");
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
        showToast("Degree and institution are required");
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
        showToast("Certification name is required");
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

  function mv(id) {
    return (document.getElementById(id)?.value || "").trim();
  }

  /* ═══ RENDER LISTS ═══ */

  function renderList(type) {
    const maps = {
      exp: {
        id: "expList",
        arr: "experiences",
        fn: (e) =>
          '<div class="ecard-title">' +
          escapeHtml(e.title) +
          " \u2014 " +
          escapeHtml(e.company) +
          '</div><div class="ecard-sub">' +
          escapeHtml(e.start || "") +
          (e.end ? " \u2013 " + escapeHtml(e.end) : "") +
          " \u00B7 " +
          escapeHtml(e.etype || "") +
          (e.loc ? " \u00B7 " + escapeHtml(e.loc) : "") +
          "</div>" +
          (e.tech
            ? '<div class="etags">' +
              e.tech
                .split(",")
                .slice(0, 5)
                .map(
                  (t) =>
                    '<span class="etag">' + escapeHtml(t.trim()) + "</span>",
                )
                .join("") +
              "</div>"
            : ""),
      },
      proj: {
        id: "projList",
        arr: "projects",
        fn: (p) =>
          '<div class="ecard-title">' +
          escapeHtml(p.name) +
          '</div><div class="ecard-sub">' +
          escapeHtml(p.role || "") +
          (p.impact ? " \u00B7 " + escapeHtml(p.impact) : "") +
          "</div>" +
          (p.tech
            ? '<div class="etags">' +
              p.tech
                .split(",")
                .slice(0, 4)
                .map(
                  (t) =>
                    '<span class="etag">' + escapeHtml(t.trim()) + "</span>",
                )
                .join("") +
              "</div>"
            : ""),
      },
      edu: {
        id: "eduList",
        arr: "education",
        fn: (e) =>
          '<div class="ecard-title">' +
          escapeHtml(e.degree) +
          '</div><div class="ecard-sub">' +
          escapeHtml(e.institution) +
          (e.year ? " \u00B7 " + escapeHtml(e.year) : "") +
          (e.cgpa ? " \u00B7 " + escapeHtml(e.cgpa) : "") +
          "</div>",
      },
      cert: {
        id: "certList",
        arr: "certifications",
        fn: (c) =>
          '<div class="ecard-title">' +
          escapeHtml(c.name) +
          '</div><div class="ecard-sub">' +
          escapeHtml(c.org || "") +
          " \u00B7 " +
          escapeHtml(c.date || "") +
          "</div>",
      },
    };
    const m = maps[type];
    $(m.id).innerHTML = data[m.arr]
      .map(
        (item, i) =>
          '<div class="ecard"><div class="ecard-body">' +
          m.fn(item) +
          '</div><div class="ecard-actions">' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-edit-type="' +
          type +
          '" data-edit-idx="' +
          i +
          '" title="Edit" aria-label="Edit entry">\u270E</button>' +
          '<button class="btn btn-danger btn-icon btn-sm" data-del-arr="' +
          m.arr +
          '" data-del-idx="' +
          i +
          '" data-del-type="' +
          type +
          '" title="Delete" aria-label="Delete entry">\u2715</button>' +
          "</div></div>",
      )
      .join("");
  }

  function removeItem(arr, i, type) {
    if (!confirm("Delete this entry?")) return;
    data[arr].splice(i, 1);
    renderList(type);
    updateProgress();
    saveAllData();
  }

  /* ═══ SKILLS ═══ */

  function addSkill(type) {
    const inp = $(SKILL_MAP[type].input);
    const val = inp.value.trim();
    if (!val) return;
    val
      .split(",")
      .map((s) => s.trim())
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
    $(SKILL_MAP[type].tags).innerHTML = data.skills[type]
      .map(
        (s, i) =>
          '<span class="chip">' +
          escapeHtml(s) +
          '<button class="chip-x" data-remove-skill="' +
          type +
          '" data-remove-idx="' +
          i +
          '" aria-label="Remove ' +
          escapeAttr(s) +
          '">\u00D7</button></span>',
      )
      .join("");
  }

  function removeSkill(type, i) {
    data.skills[type].splice(i, 1);
    renderTags(type);
    updateProgress();
    saveAllData();
  }

  /* ═══ TUTORIAL ═══ */

  function openTutorial() {
    $("tutorialOverlay").classList.add("open");
  }

  function closeTutorial() {
    $("tutorialOverlay").classList.remove("open");
  }

  /* ═══ CLEAR ALL DATA ═══ */

  function clearAllData() {
    if (!confirm("Clear all CV data and start fresh? This cannot be undone."))
      return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("cvforge_groq_key");
    localStorage.removeItem("cvforge_visited");
    location.reload();
  }

  /* ═══ EVENT DELEGATION ═══ */

  function setupEventListeners() {
    /* Sidebar navigation */
    document.querySelectorAll(".sitem").forEach((el, i) => {
      el.addEventListener("click", () => goTo(i));
    });

    /* Mobile nav */
    document.querySelectorAll(".mnav-item").forEach((el, i) => {
      el.addEventListener("click", () => goTo(i));
    });

    /* Nav-row buttons with data-nav */
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => goTo(parseInt(el.dataset.nav, 10)));
    });

    /* Add entry buttons */
    document.querySelectorAll("[data-modal]").forEach((el) => {
      el.addEventListener("click", () => openModal(el.dataset.modal));
    });

    /* Skill add buttons */
    document.querySelectorAll("[data-skill]").forEach((el) => {
      el.addEventListener("click", () => addSkill(el.dataset.skill));
    });

    /* Skill input Enter key */
    Object.keys(SKILL_MAP).forEach((type) => {
      const inp = $(SKILL_MAP[type].input);
      if (inp) {
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addSkill(type);
          }
        });
      }
    });

    /* Edit/Delete entry delegation */
    $("mainArea").addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-edit-type]");
      if (editBtn) {
        openModal(
          editBtn.dataset.editType,
          parseInt(editBtn.dataset.editIdx, 10),
        );
        return;
      }
      const delBtn = e.target.closest("[data-del-arr]");
      if (delBtn) {
        removeItem(
          delBtn.dataset.delArr,
          parseInt(delBtn.dataset.delIdx, 10),
          delBtn.dataset.delType,
        );
        return;
      }
    });

    /* Remove skill delegation */
    document.addEventListener("click", (e) => {
      const chipBtn = e.target.closest("[data-remove-skill]");
      if (chipBtn) {
        removeSkill(
          chipBtn.dataset.removeSkill,
          parseInt(chipBtn.dataset.removeIdx, 10),
        );
      }
    });

    /* Top bar */
    $("sidebarToggle").addEventListener("click", toggleSidebar);
    $("sidebarOverlay").addEventListener("click", closeSidebar);
    $("apiKeyBtn").addEventListener("click", openApiKeyModal);
    $("topScorePill").addEventListener("click", () => goTo(8));
    $("topScorePill").addEventListener("keydown", (e) => {
      if (e.key === "Enter") goTo(8);
    });

    /* API key modal */
    $("apiKeyCloseBtn").addEventListener("click", closeApiKeyModal);
    $("apiKeyCancelBtn").addEventListener("click", closeApiKeyModal);
    $("apiKeySaveBtn").addEventListener("click", saveApiKey);
    $("apiKeyOverlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeApiKeyModal();
    });

    /* Entry modal */
    $("modalCloseBtn").addEventListener("click", closeModal);
    $("modalCancelBtn").addEventListener("click", closeModal);
    $("modalSaveBtn").addEventListener("click", saveModal);
    $("overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    /* Tutorial */
    $("tutorialBtn").addEventListener("click", openTutorial);
    $("tutorialCloseBtn").addEventListener("click", closeTutorial);
    $("tutorialOverlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeTutorial();
    });

    /* Clear data */
    $("clearDataBtn").addEventListener("click", clearAllData);

    /* Summary */
    $("aiSumBtn").addEventListener("click", aiSummary);

    /* Keywords */
    $("kwBtn").addEventListener("click", aiExtractKeywords);

    /* Skills extract */
    $("aiSkillBtn").addEventListener("click", aiExtractSkills);

    /* Generate */
    $("genBtn").addEventListener("click", generateCV);
    $("genBtn2").addEventListener("click", generateCV);

    /* Edit CV */
    $("editBtn").addEventListener("click", toggleEdit);
    $("saveEditBtn").addEventListener("click", saveEdit);
    $("cancelEditBtn").addEventListener("click", cancelEdit);

    /* AI Polish */
    $("polishBtn").addEventListener("click", aiPolishCV);

    /* Export buttons */
    $("exportPdfBtn").addEventListener("click", exportPDF);
    $("exportRtfBtn").addEventListener("click", exportRtf);
    $("downloadTxtBtn").addEventListener("click", downloadTxt);
    $("exportHtmlBtn").addEventListener("click", exportHTML);
    $("copyCvBtn").addEventListener("click", copyCV);

    /* Export cards */
    $("expPdfCard").addEventListener("click", exportPDF);
    $("expRtfCard").addEventListener("click", exportRtf);
    $("expTxtCard").addEventListener("click", downloadTxt);
    $("expHtmlCard").addEventListener("click", exportHTML);

    /* Set key from empty state */
    $("setKeyEmptyBtn").addEventListener("click", openApiKeyModal);

    /* Enhance bullets (delegated since button is dynamically created) */
    $("overlay").addEventListener("click", (e) => {
      const btn = e.target.closest("#enhanceBtn");
      if (btn) {
        aiEnhanceBullets("mf_resp", "mf_achiev", btn);
      }
    });

    /* Escape key for modals */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ($("tutorialOverlay").classList.contains("open")) closeTutorial();
        else if ($("apiKeyOverlay").classList.contains("open"))
          closeApiKeyModal();
        else if ($("overlay").classList.contains("open")) closeModal();
      }
    });

    /* Auto-save on input changes (debounced) */
    FIELD_IDS.forEach((id) => {
      const el = $(id);
      if (el) {
        el.addEventListener("input", debouncedSave);
        el.addEventListener("change", debouncedSave);
      }
    });

    /* Update progress on key field inputs */
    ["targetRole", "industry", "fullName", "email", "summary"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", updateProgress);
    });

    /* beforeunload warning */
    window.addEventListener("beforeunload", (e) => {
      if (
        g("targetRole") ||
        g("fullName") ||
        g("summary") ||
        data.experiences.length > 0 ||
        data.education.length > 0
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ═══ INIT ═══ */

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

  /* Start */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
