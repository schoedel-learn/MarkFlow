import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebLayoutComponent } from './web-layout/web-layout';
import { ExtLayoutComponent } from './ext-layout/ext-layout';
import { environment } from '../environments/environment';
import { CoreStateService } from './core-state';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, WebLayoutComponent, ExtLayoutComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  isExtension = environment.isExtension;
  private state = inject(CoreStateService);

  ngOnInit() {
    this.state.initAuth();
  }
}
