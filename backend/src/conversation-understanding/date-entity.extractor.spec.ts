import { extractRequestedDate } from './date-entity.extractor';

describe('extractRequestedDate',()=>{
  const now=new Date('2026-08-08T02:00:00.000Z');

  it('resolves relative dates in the tenant timezone',()=>{
    expect(extractRequestedDate('mañana','America/Bogota',now)).toBe('2026-08-08');
  });

  it('supports localized month names and explicit years',()=>{
    expect(extractRequestedDate('15 de agosto de 2026','America/Bogota',now)).toBe('2026-08-15');
    expect(extractRequestedDate('16 August 2026','America/Bogota',now)).toBe('2026-08-16');
    expect(extractRequestedDate('August 17, 2026','America/Bogota',now)).toBe('2026-08-17');
  });

  it('rejects invalid, past, and distant dates',()=>{
    expect(extractRequestedDate('31/02/2026','America/Bogota',now)).toBeNull();
    expect(extractRequestedDate('1/01/2026','America/Bogota',now)).toBeNull();
    expect(extractRequestedDate('31/12/2026','America/Bogota',now)).toBeNull();
  });
});
