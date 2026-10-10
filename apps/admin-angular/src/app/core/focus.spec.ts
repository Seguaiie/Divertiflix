import { ApplicationRef, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { restoreLostFocus } from './focus';

describe('restoreLostFocus', () => {
  let main: HTMLElement;
  let button: HTMLButtonElement;

  beforeEach(() => {
    main = document.createElement('main');
    main.id = 'main';
    main.tabIndex = -1;
    button = document.createElement('button');
    document.body.append(main, button);
  });
  afterEach(() => { main.remove(); button.remove(); });

  const run = () => { restoreLostFocus(TestBed.inject(Injector)); TestBed.inject(ApplicationRef).tick(); };

  it('ramène le focus sur le contenu quand il est tombé sur <body>', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    run();
    expect(document.activeElement).toBe(main);
  });

  it('ne touche pas au focus quand un élément le garde', () => {
    button.focus();
    run();
    expect(document.activeElement).toBe(button);
  });
});
