import 'dotenv/config';
import { pool } from '../../src/shared/db.js';
import { tenantRepository } from '../../src/modules/tenants/tenant.repository.js';
import { userRepository } from '../../src/modules/users/user.repository.js';
import { hashPassword } from '../../src/modules/auth/auth.utils.js';
import { widgetRepository } from '../../src/modules/widgets/widget.repository.js';

async function seed() {
  console.log('[Seed] Seeding demo tenant and widget...');

  // 1. Create or find demo tenant
  const slug = 'acme-demo';
  let tenant = await tenantRepository.findBySlug(slug);
  if (!tenant) {
    tenant = await tenantRepository.create('Acme Demo Corp', slug);
    console.log(`[Seed] Created tenant: ${tenant.name} (${tenant.id})`);
  } else {
    console.log(`[Seed] Found existing tenant: ${tenant.name} (${tenant.id})`);
  }

  // 2. Create or find demo user
  const email = 'demo@flyrank.test';
  let user = await userRepository.findByEmail(email);
  if (!user) {
    const passwordHash = await hashPassword('Password123!');
    user = await userRepository.create(tenant.id, email, passwordHash, 'owner');
    console.log(`[Seed] Created demo user: ${user.email} (${user.id})`);
  } else {
    console.log(`[Seed] Found demo user: ${user.email} (${user.id})`);
  }

  // 3. Create or find demo widget
  const widgets = await widgetRepository.listByTenant(tenant.id);
  let widget = widgets.find((w) => w.name === 'Contact & Lead Capture Form');

  if (!widget) {
    widget = await widgetRepository.create(tenant.id, {
      name: 'Contact & Lead Capture Form',
      isActive: true,
      allowedOrigins: ['http://localhost:5000', 'http://127.0.0.1:5000'],
      fields: [
        { name: 'name', type: 'text', label: 'Full Name', required: true },
        { name: 'email', type: 'email', label: 'Work Email', required: true },
        { name: 'company', type: 'text', label: 'Company / Organization', required: false },
        {
          name: 'message',
          type: 'textarea',
          label: 'Project Description / Inquiry',
          required: false,
        },
      ],
      theme: {
        primaryColor: '#2563eb',
        buttonText: 'Send Inquiry',
      },
    });
    console.log(`[Seed] Created demo widget: ${widget.id}`);
  } else {
    console.log(`[Seed] Found existing demo widget: ${widget.id}`);
  }

  console.log('\n==================================================');
  console.log('DEMO DATA READY:');
  console.log(`Tenant:      ${tenant.name} (${tenant.id})`);
  console.log(`Credentials: ${user.email} / Password123!`);
  console.log(`Widget ID:   ${widget.id}`);
  console.log(`Embed Snippet:`);
  console.log(`<script src="http://localhost:4000/widget.js?id=${widget.id}"></script>`);
  console.log(`Demo URL:    http://localhost:5000/index.html?id=${widget.id}`);
  console.log('==================================================\n');

  await pool.end();
  return widget.id;
}

seed().catch((err) => {
  console.error('[Seed Error]:', err);
  process.exit(1);
});
