import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExtLayoutComponent } from './ext-layout';

describe('ExtLayoutComponent', () => {
  let component: ExtLayoutComponent;
  let fixture: ComponentFixture<ExtLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExtLayoutComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExtLayoutComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
