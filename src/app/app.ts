import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebLayoutComponent } from './web-layout/web-layout';
import { ExtLayoutComponent } from './ext-layout/ext-layout';
import { environment } from '../environments/environment';
import { CoreStateService } from './core-state';
import { ThemeService } from './theme.service';

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
  // Eagerly construct so the theme attribute is applied on app startup,
  // keeping Angular's view in sync with the boot script in index.html.
  private theme = inject(ThemeService);

  ngOnInit() {
    this.state.initAuth();
  }
}
