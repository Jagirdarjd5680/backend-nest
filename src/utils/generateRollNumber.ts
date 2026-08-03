import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function generateRollNumber({ name = '', email = '', phone = '' }) {
  const nameParts = name.trim().toUpperCase().replace(/[^A-Z ]/g, '').split(' ').filter(Boolean);
  const first = nameParts[0] || 'XX';
  const last = nameParts[1] || nameParts[0] || 'XX';
  const namePart = (first.slice(0, 2) + last.slice(0, 2)).padEnd(4, 'X');

  const emailLocal = (email.split('@')[0] || '').replace(/[^0-9]/g, '');
  const emailPart = emailLocal.slice(0, 4).padStart(4, '0');

  const digits = (phone || '').replace(/[^0-9]/g, '');
  const phonePart = digits.slice(-4).padStart(4, '0');

  const prefix = namePart + emailPart + phonePart; 

  let seq = 1;
  const existing = await prisma.user.findMany({
    where: {
      rollNumber: {
        startsWith: prefix,
      },
    },
    select: {
      rollNumber: true,
    },
    orderBy: {
      rollNumber: 'asc',
    },
  });

  if (existing.length > 0) {
    const usedSeqs = existing
      .map(u => parseInt((u.rollNumber || '').slice(prefix.length), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
    for (let i = 0; i < usedSeqs.length; i++) {
      if (usedSeqs[i] !== i + 1) {
        seq = i + 1;
        break;
      }
      seq = usedSeqs[i] + 1;
    }
  }

  const seqPart = String(seq).padStart(3, '0');
  return prefix + seqPart;
}
