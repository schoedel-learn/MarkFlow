import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WebLayout } from './web-layout';

describe('WebLayout', () => {
  let component: WebLayout;
  let fixture: ComponentFixture<WebLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WebLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WebLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
