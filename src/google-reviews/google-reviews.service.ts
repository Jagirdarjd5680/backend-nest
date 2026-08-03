import { Injectable } from '@nestjs/common';

@Injectable()
export class GoogleReviewsService {
  async fetchReviews() {
    const mockReviews = [
      { author: 'Rahul Sharma', rating: 5, comment: 'Amazing graphics course! The best in India.', date: '2 days ago' },
      { author: 'Priya Patel', rating: 5, comment: 'The placement support is top-notch.', date: '1 week ago' },
      { author: 'Amit Verma', rating: 4, comment: 'Great teachers and practical approach.', date: '3 days ago' },
    ];

    return {
      success: true,
      data: mockReviews,
    };
  }
}
