import { selectionAsNaturalText, validateInteractiveMessage } from './interactive-message.types';

describe('interactive message contracts', () => {
  it('accepts three reply buttons with stable identifiers', () => {
    expect(() => validateInteractiveMessage({
      type: 'buttons', body: '¿Deseas agregar una bebida?', options: [
        { id: 'recommend:add:agua', title: 'Sí, agregar' },
        { id: 'recommend:list:drinks', title: 'Ver bebidas' },
        { id: 'recommend:reject', title: 'No, gracias' },
      ],
    })).not.toThrow();
  });

  it('rejects a fourth reply button before calling Meta', () => {
    expect(() => validateInteractiveMessage({
      type: 'buttons', body: 'Elige', options: ['1', '2', '3', '4'].map((id) => ({ id, title: id })),
    })).toThrow('between 1 and 3');
  });

  it('uses the visible selection as natural-language fallback', () => {
    expect(selectionAsNaturalText({ type: 'button', id: 'delivery:pickup', title: 'Recoger en el local' }))
      .toBe('Recoger en el local');
  });
});
