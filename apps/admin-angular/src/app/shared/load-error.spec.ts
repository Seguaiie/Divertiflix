import { TestBed } from '@angular/core/testing';
import { LoadError } from './load-error';

describe('LoadError', () => {
  let main: HTMLElement;

  beforeEach(() => {
    main = document.createElement('main');
    main.id = 'main';
    main.tabIndex = -1;
    document.body.append(main);
  });
  afterEach(() => main.remove());

  function render() {
    const fixture = TestBed.createComponent(LoadError);
    fixture.componentRef.setInput('message', "Les billets n'ont pas pu être lus.");
    fixture.detectChanges();
    return fixture;
  }

  it('annonce l\'erreur avec son message et propose « Réessayer »', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Chargement impossible');
    expect(el.textContent).toContain("Les billets n'ont pas pu être lus.");
    expect(el.querySelector('button')?.textContent?.trim()).toBe('Réessayer');
  });

  it('« Réessayer » demande la relecture et passe le focus à la page : le bouton disparaît, le focus ne tombe pas sur <body>', () => {
    const fixture = render();
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    button.focus();
    expect(document.activeElement).toBe(button);

    button.click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(main);
  });
});
