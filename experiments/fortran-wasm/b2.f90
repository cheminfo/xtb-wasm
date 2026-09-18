program main
  real, allocatable :: a(:,:), b(:)
  integer :: i
  allocate(a(3,3), b(3))
  do i=1,3
     b(i)=real(i); a(:,i)=real(i)
  end do
  print *, "b2 sum=", sum(matmul(a,b))
  deallocate(a,b)
end program
