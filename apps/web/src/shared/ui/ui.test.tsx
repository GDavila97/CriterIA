import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import {
  Badge,
  Button,
  buttonClass,
  CheckboxField,
  Drawer,
  Icon,
  Logo,
  Notice,
  Segmented,
  SelectField,
  Tabs,
  TextArea,
  TextField,
} from './index';

describe('Button', () => {
  it('defaults to a secondary button that does not submit forms', () => {
    render(<Button>Guardar</Button>);

    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('secondary');
  });

  it('composes classes for links styled as buttons', () => {
    expect(buttonClass({ variant: 'primary', block: true, small: true })).toBe(
      'button primary block small',
    );
    expect(buttonClass()).toBe('button secondary');
  });
});

describe('fields', () => {
  it('label inputs and announce errors next to them', () => {
    render(<TextField label="Correo" hint="Tu correo" error="Correo inválido" defaultValue="x" />);

    const input = screen.getByLabelText('Correo');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Tu correo Correo inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('Correo inválido');
  });

  it('render text areas, selects and checkboxes', async () => {
    const onChange = vi.fn();
    render(
      <>
        <TextArea label="Requerimiento" defaultValue="abc" />
        <SelectField
          label="Modelo"
          value="a"
          onChange={onChange}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B', disabled: true },
          ]}
        />
        <CheckboxField label="Guardar" />
      </>,
    );

    expect(screen.getByLabelText('Requerimiento')).toHaveValue('abc');
    expect(screen.getByRole('option', { name: 'B' })).toBeDisabled();
    expect(screen.getByLabelText('Modelo')).not.toHaveAttribute('aria-describedby');
    await userEvent.click(screen.getByLabelText('Guardar'));
    expect(screen.getByLabelText('Guardar')).toBeChecked();
  });
});

describe('Tabs', () => {
  const items = [
    { id: 'a', label: 'Historias', content: 'Contenido A' },
    { id: 'b', label: 'Casos', content: 'Contenido B' },
    { id: 'c', label: 'Gherkin', content: 'Contenido C' },
  ];

  it('switch panels by click and by keyboard, wrapping around', async () => {
    render(<Tabs label="Artefactos" items={items} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Casos' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Contenido B');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Historias' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Historias' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Enter' });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Contenido B');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Contenido A');
  });
});

describe('Segmented', () => {
  function Harness() {
    const [value, setValue] = useState<'clasica' | 'oficina'>('clasica');
    return (
      <Segmented
        label="Vista"
        value={value}
        onChange={setValue}
        options={[
          { value: 'clasica', label: 'Clásica' },
          { value: 'oficina', label: 'Oficina' },
        ]}
      />
    );
  }

  it('acts as a radio group with arrow keys', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('radio', { name: 'Oficina' }));
    expect(screen.getByRole('radio', { name: 'Oficina' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Clásica' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'a' });
    expect(screen.getByRole('radio', { name: 'Oficina' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Drawer', () => {
  it('opens as a modal dialog and closes from its button', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Drawer open title="Agente" onClose={onClose}>
        Contenido
      </Drawer>,
    );

    expect(screen.getByRole('dialog', { name: 'Agente' })).toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();

    rerender(
      <Drawer open={false} title="Agente" onClose={onClose}>
        {null}
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog).not.toHaveAttribute('open');
    expect(dialog).toHaveTextContent('Contenido');
  });

  it('lets Escape go through the parent so the exit can play', () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Agente" onClose={onClose}>
        Contenido
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Agente' });
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute('open');
  });

  it('closes only after the exit animation ends', async () => {
    let end = () => {};
    const finished = new Promise<void>((resolve) => {
      end = resolve;
    });
    // jsdom has no Web Animations, so the running exit is stubbed.
    HTMLElement.prototype.getAnimations = () => [{ finished } as unknown as Animation];
    const props = { title: 'Agente', onClose: vi.fn() };
    const { rerender } = render(
      <Drawer open {...props}>
        Contenido
      </Drawer>,
    );
    rerender(
      <Drawer open={false} {...props}>
        {null}
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Agente' });
    expect(dialog).toHaveAttribute('data-closing');
    expect(dialog).toHaveAttribute('open');

    end();
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(dialog).not.toHaveAttribute('data-closing');
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
  });
});

describe('small pieces', () => {
  it('render notices, badges, icons and the logo', () => {
    render(
      <>
        <Notice tone="error">Algo falló</Notice>
        <Notice>Dato</Notice>
        <Notice tone="ok">Listo</Notice>
        <Badge tone="revisor">Revisor</Badge>
        <Badge>QA</Badge>
        <Icon name="candado" label="Seguro" />
        <Logo />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Algo falló');
    expect(screen.getByText('Revisor').className).toContain('revisor');
    expect(screen.getByRole('img', { name: 'Seguro' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CriterIA, inicio' })).toHaveAttribute('href', '/');
  });
});
