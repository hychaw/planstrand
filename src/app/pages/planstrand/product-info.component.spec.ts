import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ProductInfoComponent } from './product-info.component';
import { versions } from '../../../environments/versions';

describe('Planstrand About identity', () => {
  const revision = versions.revision;
  afterEach(() => {
    versions.revision = revision;
  });

  const render = (build: string): HTMLElement => {
    versions.revision = build;
    TestBed.configureTestingModule({
      imports: [ProductInfoComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
      ],
    });
    const fixture = TestBed.createComponent(ProductInfoComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  };

  it('presents the product version and short build with accurate attribution', () => {
    const element = render('526d9b156353dc9de6dc39b159d40b99fcf4a25f');
    expect(element.textContent).toContain('Version 1.1.0-rc.1');
    expect(element.textContent).toContain('Build 526d9b1');
    expect(element.textContent).not.toContain('19.1.0');
    expect(element.querySelector('details')?.textContent).toContain('Super Productivity');
    expect(element.querySelector('details')?.textContent).toContain('MIT License');
    expect(element.querySelector('a[href="3rdpartylicenses.txt"]')).not.toBeNull();
    expect(element.textContent).toContain('Copyright (c) 2026 How Yee Chaw');
    expect(
      element.querySelector('a[href="assets/planstrand-license/LICENSE"]'),
    ).not.toBeNull();
    expect(element.querySelector('a[href="assets/upstream-license.txt"]')).not.toBeNull();
  });

  it('omits unavailable build information', () => {
    const element = render('NO_REV');
    expect(element.textContent).not.toContain('Build');
    expect(element.textContent).not.toMatch(/NO_REV|NO_BRANCH/);
  });
});
