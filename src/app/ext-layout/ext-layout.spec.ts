import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExtLayout } from './ext-layout';

describe('ExtLayout', () => {
  let component: ExtLayout;
  let fixture: ComponentFixture<ExtLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExtLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExtLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
