import { TestBed } from '@angular/core/testing';

import { CoreState } from './core-state';

describe('CoreState', () => {
  let service: CoreState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CoreState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
