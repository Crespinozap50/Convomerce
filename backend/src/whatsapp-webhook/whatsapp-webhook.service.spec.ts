import { parseInteractiveSelection, parseUnixTimestamp } from './whatsapp-webhook.service';

describe('parseUnixTimestamp', () => {
  it('convierte segundos Unix válidos', () => {
    expect(parseUnixTimestamp('1700000000')?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it.each([undefined, '', 'abc', '-1'])('ignora un timestamp inválido: %s', (value) => {
    expect(parseUnixTimestamp(value)).toBeUndefined();
  });

  it('normaliza una respuesta de botón conservando id y texto visible', () => {
    expect(parseInteractiveSelection({
      type: 'button_reply', button_reply: { id: 'delivery:pickup', title: 'Recoger en el local' },
    })).toEqual({ type: 'button', id: 'delivery:pickup', title: 'Recoger en el local' });
  });
});
