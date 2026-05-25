/*
 * Single source of truth for fallback content shown when Supabase has no saved
 * value yet (or the content API is unreachable). Loaded as a plain global before
 * admin.js and the public Minor Ailments / Incident Report pages.
 *
 * Consumers deep-copy before mutating, so this object can be shared safely.
 */
(function () {
  window.PAMCA_DEFAULTS = {
    // Minor Ailments — the three pillars.
    pillars: [
      {
        title: 'Practical',
        desc: 'Born from real-world pharmacy experience. Every feature, workflow, and solution has been crafted by a practicing pharmacist who understands the daily challenges, time pressures, and patient care complexities you face in community pharmacy practice.'
      },
      {
        title: 'Accessible',
        desc: 'Breakthrough flexibility that works wherever you do. Whether you\'re on desktop, laptop, tablet, or mobile device, seamlessly manage multiple pharmacy locations and coordinate with your entire pharmacy team from anywhere, anytime.'
      },
      {
        title: 'Multi-functional',
        desc: 'Your complete minor ailments command center. Every tool, process, and requirement integrated into one powerful platform:',
        list: [
          'Complete billing documentation with automated primary care provider notifications',
          'Intelligent patient eligibility verification including annual claim tracking',
          'Comprehensive care plan tools (non-pharmaceutical interventions, OTC recommendations, specialist referrals)',
          'Real-time access to allowable medications (Schedule 4 to O. Reg. 202/94 compliance)',
          'Automated billing PIN generation tailored to each service type',
          'Smart follow-up scheduling and patient care continuity management'
        ]
      }
    ],

    // Incident Report page content.
    incidentReport: {
      heroTitle: 'PharmaScript IR: Incident Reporting for Ontario Pharmacies',
      heroSubheader: 'A purpose-built, AIMS-aligned platform designed for Ontario pharmacists — getting your pharmacy ready for the 2027 OCP requirements, starting now.',
      heroTag: 'Start now to build compliant reporting habits before the January 1, 2027 AIMS deadline.',
      heroTags: [
        'OCP AIMS-Aligned',
        'NIDR Ready',
        'Start now to build compliant reporting habits before the January 1, 2027 AIMS deadline.'
      ],
      prepTitle: 'Prepare for 2027 Without Disrupting Daily Workflow',
      prepSubheader: 'New AIMS Program requirements take effect on January 1, 2027. This makes 2026 a critical transition and preparation year for pharmacies across Ontario.\n\nJoin pharmacies already using PharmaScript for Minor Ailment Prescribing and start incident reporting with PharmaScript IR. Both tools are available free until December 31, 2026.',
      prepComment: 'New Tag',
      standardsTitle: 'Platform Features Aligned with OCP 2027 AIMS Standards',
      standardsCopy: '',
      standardsBullets: [
        'Unique Logins: For all registered staff (pharmacists and technicians), with consideration for occasional and relief staff.',
        'Daily NIDR Reporting: Automatically transmits de-identified incident data to NIDR every day.',
        'Complete Mandatory Data: Enforces all 13 mandatory NIDR data fields with built-in scrubbing to avoid sending names.',
        'Quarterly CQI Module: Supports documentation of attendance, minutes, and action plans.',
        'Medication Safety SSA: Includes a Medication Safety Self-Assessment tool for ongoing quality improvement.'
      ],
      ctaTitle: 'Get Started with PharmaScript IR',
      ctaText: 'Join users already succeeding with PharmaScript for Minor Ailment Prescribing and begin incident reporting with PharmaScript IR today.'
    },

    // Legacy copy that should be treated as empty when migrating old content.
    legacyStandardsCopyText: 'PharmaScript IR helps Ontario pharmacies transition into the 2027 AIMS environment with reporting controls that support daily workflow and quality improvement.'
  };
})();
