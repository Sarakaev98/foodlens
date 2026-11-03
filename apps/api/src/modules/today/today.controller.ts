import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { TodayLog } from '@foodlens/core';
import { CurrentUserId } from '../../common/current-user-id.decorator';
import { TodayService } from './today.service';

@Controller('today')
export class TodayController {
  constructor(private readonly today: TodayService) {}

  /** Журнал дня: GET /today?date=YYYY-MM-DD (локальная дата клиента). */
  @Get()
  get(@CurrentUserId() userId: string, @Query('date') date: unknown): TodayLog {
    return this.today.get(userId, date);
  }

  /** Добавляет запись { id, date, name, source, caloriesKcal, proteinG, carbsG, fatG }. Повтор того же id не дублирует. */
  @Post('entries')
  @HttpCode(200)
  add(@CurrentUserId() userId: string, @Body() body: unknown): TodayLog {
    return this.today.add(userId, body);
  }
}
