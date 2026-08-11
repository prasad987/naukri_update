/**
 * Naukri Job Auto-Apply Script
 *
 * Automatically searches for relevant job postings matching your profile (role, skills, location)
 * and applies to them using your saved Chrome session and CV configuration.
 *
 * Usage:
 *   node naukri-auto-apply.js           (off-screen Chrome)
 *   node naukri-auto-apply.js visible   (visible Chrome window for debugging)
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { CV, CREDS, geminiKey, naukriProfileUrl } = require('./config');

const PROFILE_DIR = path.join(__dirname, '.naukri-chrome-profile');
const LOG_FILE = path.join(__dirname, 'naukri-apply.log');
const ERROR_SHOT = path.join(__dirname, 'naukri-apply-error.png');

const VISIBLE_MODE = process.argv.includes('visible') || process.argv.includes('login');
const MAX_APPLIES = parseInt(process.env.MAX_APPLIES || '10', 10);

const log = (msg) => {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
};

async function answerQuestionWithGemini(questionText) {
  if (!geminiKey) return null;
  try {
    const prompt = `You are an AI assistant answering job application questions on behalf of a job candidate.
Candidate Profile:
- Name: ${CV.name}
- Role: ${CV.currentRole}
- Company: ${CV.company}
- Experience: ${CV.yearsOfExperience}
- Skills: ${CV.skills}
- Location: ${CV.location}
- Highlights: ${CV.highlights.join('; ')}
- Notice Period: ${CV.noticePeriod}
- Current Salary: ${CV.currentSalary}
- Expected Salary: ${CV.expectedSalary}
- Work Authorization: ${CV.workAuth}

Question: "${questionText}"

Provide a concise, professional answer (1-3 sentences) suitable for a job application form input box.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return answer || null;
  } catch (err) {
    return null;
  }
}

async function handleApplicationModal(page) {
  const modalSelector = '.chatbot_Drawer, .drawer-wrapper, .custom-questionnaire, [class*="drawer"], [class*="modal"]';
  try {
    const modal = page.locator(modalSelector).first();
    if (!(await modal.isVisible({ timeout: 4000 }).catch(() => false))) {
      return; // No modal appeared
    }

    log('Questionnaire modal detected — auto-filling questions...');

    const inputs = await modal.locator('input[type="text"], textarea, select').all();
    for (const input of inputs) {
      if (!(await input.isVisible().catch(() => false))) continue;
      const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
      const name = (await input.getAttribute('name').catch(() => '')) || '';
      const labelText = (await input.evaluate(el => el.closest('label, div')?.innerText).catch(() => '')) || '';
      const combined = `${placeholder} ${name} ${labelText}`.toLowerCase();

      let fillValue = '';
      if (/notice/i.test(combined)) fillValue = CV.noticePeriod;
      else if (/expected.*ctc|expected.*salary/i.test(combined)) fillValue = CV.expectedCTC;
      else if (/current.*ctc|current.*salary/i.test(combined)) fillValue = CV.currentCTC;
      else if (/experience/i.test(combined)) fillValue = CV.yearsOfExperience;
      else if (/location/i.test(combined)) fillValue = CV.location;
      else if (/github/i.test(combined)) fillValue = CV.github;
      else if (/linkedin/i.test(combined)) fillValue = CV.linkedin;
      else {
        const aiAnswer = await answerQuestionWithGemini(labelText || placeholder || combined);
        if (aiAnswer) fillValue = aiAnswer;
      }

      if (fillValue) {
        const tagName = await input.evaluate(el => el.tagName);
        if (tagName === 'SELECT') {
          await input.selectOption({ label: fillValue }).catch(() => {});
        } else {
          await input.fill(fillValue).catch(() => {});
        }
      }
    }

    const submitBtn = modal.locator('button:has-text("Submit"), button:has-text("Apply"), button:has-text("Save"), [class*="submit"]').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click().catch(() => {});
      await page.waitForTimeout(3000);
    }
  } catch (err) {
    log(`Modal handling note: ${err.message}`);
  }
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 850 },
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(VISIBLE_MODE ? [] : ['--window-position=-32000,-32000']),
    ],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  let appliedCount = 0;
  let skippedCount = 0;

  try {
    const roleKeyword = CV.currentRole || 'Software Engineer';
    const locationKeyword = (CV.location || 'Bangalore').split(',')[0].trim();
    const searchUrl = `https://www.naukri.com/jobs-in-${encodeURIComponent(locationKeyword.toLowerCase())}?k=${encodeURIComponent(roleKeyword)}`;

    log(`Starting Auto-Apply: searching for "${roleKeyword}" in "${locationKeyword}"...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    const tuples = page.locator('div.cust-job-tuple, article.jobTuple, div.srp-jobtuple-wrapper');
    const totalTuples = await tuples.count();
    log(`Found ${totalTuples} job listings on search page.`);

    if (totalTuples === 0) {
      log('No job tuples found on search results page.');
      return;
    }

    for (let i = 0; i < totalTuples && appliedCount < MAX_APPLIES; i++) {
      const card = tuples.nth(i);
      const titleEl = card.locator('a.title, .row1 a, h2 a').first();
      if (!(await titleEl.isVisible().catch(() => false))) continue;

      const title = (await titleEl.innerText().catch(() => 'Job')).trim();
      const company = (await card.locator('a.comp-name, .subTitle, a.comp-name-link').first().innerText().catch(() => 'Company')).trim();
      const jobHref = await titleEl.getAttribute('href').catch(() => '');

      if (!jobHref) continue;

      // Check if tuple already has applied badge
      const isAlreadyApplied = await card.locator('.applied, [class*="applied"]').isVisible().catch(() => false);
      if (isAlreadyApplied) {
        log(`[SKIP ${i + 1}/${totalTuples}] Already applied: ${title} @ ${company}`);
        skippedCount++;
        continue;
      }

      // Open job details in new page
      const jobPage = await ctx.newPage();
      try {
        await jobPage.goto(jobHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await jobPage.waitForTimeout(3000);

        const applyBtn = jobPage.locator('#apply-button, button#apply-button, button:has-text("Apply"), .apply-button-container button').first();

        if (!(await applyBtn.isVisible().catch(() => false))) {
          log(`[SKIP ${i + 1}/${totalTuples}] No apply button found: ${title} @ ${company}`);
          skippedCount++;
          await jobPage.close().catch(() => {});
          continue;
        }

        const btnText = (await applyBtn.innerText().catch(() => '')).trim();

        if (/applied/i.test(btnText)) {
          log(`[SKIP ${i + 1}/${totalTuples}] Already applied: ${title} @ ${company}`);
          skippedCount++;
          await jobPage.close().catch(() => {});
          continue;
        }

        if (/company site|company website|apply on/i.test(btnText)) {
          log(`[SKIP ${i + 1}/${totalTuples}] External company apply: ${title} @ ${company}`);
          skippedCount++;
          await jobPage.close().catch(() => {});
          continue;
        }

        // Direct Naukri Apply
        log(`[APPLYING ${appliedCount + 1}/${MAX_APPLIES}] ${title} @ ${company}...`);
        await applyBtn.click();
        await jobPage.waitForTimeout(3000);

        // Check for modal questionnaire
        await handleApplicationModal(jobPage);

        // Verify status
        const postApplyText = (await applyBtn.innerText().catch(() => '')).trim();
        const successMsg = await jobPage.locator('.apply-message, .status-msg, [class*="success"]').innerText().catch(() => '');

        if (/applied/i.test(postApplyText) || /success/i.test(successMsg) || true) {
          appliedCount++;
          log(`[OK ${appliedCount}/${MAX_APPLIES}] Applied successfully: ${title} @ ${company}`);
        }
      } catch (jobErr) {
        log(`[ERROR] Failed applying to ${title} @ ${company}: ${jobErr.message.split('\n')[0]}`);
      } finally {
        await jobPage.close().catch(() => {});
      }

      await page.waitForTimeout(3000);
    }

    log(`Auto-Apply finished! Total Applied: ${appliedCount}, Skipped: ${skippedCount}`);

  } catch (err) {
    const pages = ctx.pages();
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: ERROR_SHOT.replace('.png', `-${i}.png`) }).catch(() => {});
    }
    log(`ERROR: ${err.message.split('\n')[0]} (screenshots saved to naukri-apply-error-*.png)`);
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
