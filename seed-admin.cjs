const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = 'purohitpraveen87@gmail.com';
  const password = 'purohitpraveen87@gmail.com';

  // Check if admin already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('✅ Admin already exists:', email);
    console.log('   Role:', existing.role);
    await prisma.$disconnect();
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const admin = await prisma.user.create({
    data: {
      name: 'Caleb',
      email,
      password: hashedPassword,
      role: 'admin',
      isActive: true,
    },
  });

  console.log('✅ Admin user created successfully!');
  console.log('   ID:', admin.id);
  console.log('   Email:', admin.email);
  console.log('   Role:', admin.role);

  await prisma.$disconnect();
}

seedAdmin().catch((e) => {
  console.error('❌ Error seeding admin:', e.message);
  prisma.$disconnect();
  process.exit(1);
});
