GEMINI EDUCATION – CHC33021 LANDING PAGE

Files:
- index.html — complete responsive landing page with CSS + JavaScript included.

What is already built:
- Responsive desktop/tablet/mobile design
- Premium Gemini-style gradient branding
- Animated hero and floating information cards
- Scroll-reveal animation system
- Animated workforce-stat counters
- Interactive FAQ accordion
- 5-step eligibility quiz
- UTM + fbclid capture into lead payload
- Sticky mobile conversion bar
- WhatsApp handoff after form completion
- Accessibility consideration via prefers-reduced-motion
- RTO / qualification disclaimers

BEFORE PUBLISHING
1. Replace the temporary CSS-made Gemini logo mark with the official Gemini logo artwork.
2. Replace example/placeholder testimonials with verified Gemini student reviews.
3. Confirm current Jobs and Skills Australia figures before launch.
4. Add a Privacy Policy URL to the form consent text.
5. Add your actual WhatsApp business number. Current wa.me links intentionally omit a number and open WhatsApp generically.
6. Connect the form to your CRM/webhook:
   Search index.html for:
   const FORM_ENDPOINT = '';
   Then insert your endpoint URL.
7. If you use Meta Ads, add Meta Pixel and Conversions API.
8. Add GA4 / Google Tag Manager as required.
9. Replace stock photos with Gemini's real student/team photos where possible for stronger trust and authenticity.
10. Confirm training provider/RTO details for the actual offer and add disclosure where appropriate.

Suggested lead events to track:
- landing_page_view
- quiz_started
- quiz_step_2
- quiz_step_3
- quiz_step_4
- lead_submitted
- whatsapp_click
- phone_click

The page is intentionally a single-focus ad funnel with minimal navigation to reduce lead leakage.
